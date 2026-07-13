"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireProjectOwner } from "@/lib/projects";
import { callLLM } from "@/lib/llm";
import type { ModelRouting } from "@/lib/llm";
import type { Database, SubmissionSourceType } from "@/lib/supabase/types";
import {
  decideDedup,
  fileKind,
  isLikelyScan,
  normalizeText,
  parseCsv,
  parseDocx,
  parsePdfText,
  parseXlsx,
  sha256Hex,
  type ColumnMapping,
  type SpreadsheetData,
} from "@/lib/parsing";

type Client = SupabaseClient<Database>;

// 인제스트 결과 요약. 클라이언트에 반환된다.
export type IngestSummary = {
  inserted: number;
  skipped: number;
  updatePending: number;
  errors: { filename: string; message: string }[];
};

const OCR_PROMPT =
  "다음 이미지/문서에서 보이는 모든 텍스트를 원문 그대로 정확히 추출하라. " +
  "설명·해석·요약·머리말 없이, 추출된 텍스트만 반환하라. 표는 행/열 순서대로 텍스트로 옮겨라.";

// ── 내부 헬퍼(비-export: server action이 아님) ──────────────────────

async function loadRouting(
  supabase: Client,
  projectId: string,
): Promise<ModelRouting> {
  const { data, error } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  if (error || !data) throw new Error("프로젝트 라우팅을 불러오지 못했습니다.");
  return data.model_routing;
}

async function downloadBytes(
  supabase: Client,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from("originals").download(path);
  if (error || !data) {
    throw new Error(`원본 파일을 불러오지 못했습니다: ${error?.message ?? path}`);
  }
  const ab = await data.arrayBuffer();
  return new Uint8Array(ab);
}

function imageMediaType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

// 비전 OCR: 이미지/PDF 파트를 추출 라우팅(purpose='추출')으로 보낸다.
async function ocrExtract(
  userId: string,
  routing: ModelRouting,
  part:
    | { type: "image"; mediaType: string; dataBase64: string }
    | { type: "document"; mediaType: "application/pdf"; dataBase64: string; filename?: string },
): Promise<string> {
  if (!part.dataBase64) {
    throw new Error("원본 파일 데이터가 비어 있습니다 — 업로드된 원본을 다시 확인하세요.");
  }
  const res = await callLLM({
    userId,
    purpose: "추출",
    modelRouting: routing,
    temperature: 0,
    messages: [{ role: "user", content: [part, { type: "text", text: OCR_PROMPT }] }],
  });
  return res.text;
}

// (project, submission_key, raw 식별값)로 기존 제출물을 찾아 중복 결정 후 반영.
// 반환: 'inserted' | 'skipped' | 'update_pending'
async function persistSubmission(
  supabase: Client,
  input: {
    projectId: string;
    submissionKey: string;
    rawStudentNo: string | null;
    rawStudentName: string | null;
    sourceFilename: string | null;
    storagePath: string | null;
    sourceType: SubmissionSourceType;
    text: string;
  },
): Promise<"inserted" | "skipped" | "update_pending"> {
  const content_text = normalizeText(input.text);
  const content_hash = sha256Hex(content_text);

  const { data: candidates } = await supabase
    .from("submissions")
    .select("id, content_hash, raw_student_no, raw_student_name")
    .eq("project_id", input.projectId)
    .eq("submission_key", input.submissionKey);

  const existing =
    (candidates ?? []).find(
      (r) =>
        (r.raw_student_no ?? "") === (input.rawStudentNo ?? "") &&
        (r.raw_student_name ?? "") === (input.rawStudentName ?? ""),
    ) ?? null;

  const decision = decideDedup(
    existing ? { id: existing.id, content_hash: existing.content_hash } : null,
    content_hash,
  );

  if (decision.action === "skip") return "skipped";

  if (decision.action === "update_pending") {
    // 자동 덮어쓰기 금지: 기존 content_text 유지, 새 내용은 pending_content에 보관(세션 6 승인).
    const { error } = await supabase
      .from("submissions")
      .update({
        match_status: "update_pending",
        pending_content: { content_text, content_hash },
      })
      .eq("id", decision.id);
    if (error) throw new Error(error.message);
    return "update_pending";
  }

  const { error } = await supabase.from("submissions").insert({
    project_id: input.projectId,
    content_text,
    content_hash,
    source_type: input.sourceType,
    submission_key: input.submissionKey,
    source_filename: input.sourceFilename,
    storage_path: input.storagePath,
    raw_student_no: input.rawStudentNo,
    raw_student_name: input.rawStudentName,
    // student_id·match_status는 기본값(NULL·'unmatched') — 매칭은 세션 6.
  });
  if (error) throw new Error(error.message);
  return "inserted";
}

function tally(
  summary: IngestSummary,
  result: "inserted" | "skipped" | "update_pending",
) {
  if (result === "inserted") summary.inserted += 1;
  else if (result === "skipped") summary.skipped += 1;
  else summary.updatePending += 1;
}

// ── OCR 담당 프로바이더·모델 저장 (extract 라우팅 갱신, 세션 5) ───────
export async function saveOcrModel(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const providerId = String(formData.get("providerId"));
  const model = String(formData.get("model") ?? "").trim();
  const { supabase } = await requireProjectOwner(projectId);
  if (!providerId || !model) throw new Error("프로바이더와 모델을 선택하세요.");

  const routing = await loadRouting(supabase, projectId);
  const next: ModelRouting = {
    ...routing,
    extract: { provider_id: providerId, model },
  };
  const { error } = await supabase
    .from("projects")
    .update({ model_routing: next })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

// ── 업로드 원본 파일 목록·삭제 (업로드-즉시-파싱 분리, 리팩토링 2 배치 6) ──
//
// 업로드는 클라이언트가 Storage에 직접 하고, 파싱/OCR(토큰 소모)은 [수합 & 매칭]
// 실행 때만 일으킨다. 원본 경로는 항상 `${userId}/${projectId}/` 하위여야 한다.

// 경로가 이 사용자·프로젝트 소유인지 검증한다(스토리지 경로 위조 방어).
function assertOwnedPath(userId: string, projectId: string, path: string): void {
  if (!path.startsWith(`${userId}/${projectId}/`)) {
    throw new Error("접근할 수 없는 파일 경로입니다.");
  }
}

// 저장 경로 마지막 세그먼트 `${uuid}__${sanitized}`에서 원래 파일명을 복원한다.
function restoreFilename(segment: string): string {
  const idx = segment.indexOf("__");
  return idx >= 0 ? segment.slice(idx + 2) : segment;
}

export type UploadedFile = {
  path: string; // originals 버킷 경로
  filename: string; // 경로 마지막 세그먼트에서 "uuid__" 이후 복원
  createdAt: string | null;
  ingested: boolean; // 이 path를 storage_path로 참조하는 제출물 존재 여부
};

export async function listUploadedFiles(
  projectId: string,
): Promise<UploadedFile[]> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const prefix = `${userId}/${projectId}`;

  const [listRes, subsRes] = await Promise.all([
    supabase.storage.from("originals").list(prefix, {
      limit: 1000,
      sortBy: { column: "created_at", order: "desc" },
    }),
    supabase
      .from("submissions")
      .select("storage_path")
      .eq("project_id", projectId)
      .not("storage_path", "is", null),
  ]);
  if (listRes.error) throw new Error(listRes.error.message);

  const ingested = new Set(
    (subsRes.data ?? []).map((s) => s.storage_path).filter(Boolean),
  );

  return (listRes.data ?? [])
    .filter((o) => o.id !== null) // 폴더 플레이스홀더 제외(방어)
    .map((o) => {
      const path = `${prefix}/${o.name}`;
      return {
        path,
        filename: restoreFilename(o.name),
        createdAt: o.created_at ?? null,
        ingested: ingested.has(path),
      };
    });
}

export async function deleteUploadedFile(
  projectId: string,
  path: string,
): Promise<void> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  assertOwnedPath(userId, projectId, path);

  // INV-5 우회 금지: 이미 수합된 파일의 원본 삭제는 추출 확인(승인) 절차를 따른다.
  const { data: sub } = await supabase
    .from("submissions")
    .select("id")
    .eq("project_id", projectId)
    .eq("storage_path", path)
    .maybeSingle();
  if (sub) {
    throw new Error(
      "이미 수합된 파일입니다 — 원본 삭제는 제출물 상세의 추출 확인(승인) 절차를 따르세요.",
    );
  }

  const { error } = await supabase.storage.from("originals").remove([path]);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

// ── 수합 실행 (1건 단위 — prepareIngest → ingestOneFile × N → finalizeIngest) ──
export type IngestTarget = { id: string; label: string }; // id = storage path, label = filename

export async function prepareIngest(
  projectId: string,
  paths: string[],
): Promise<{
  targets: IngestTarget[];
  prelude: { level: "info" | "system"; text: string }[];
}> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const prefix = `${userId}/${projectId}`;

  const { data: objs } = await supabase.storage
    .from("originals")
    .list(prefix, { limit: 1000 });
  const existing = new Set((objs ?? []).map((o) => `${prefix}/${o.name}`));

  const targets: IngestTarget[] = [];
  for (const path of paths) {
    assertOwnedPath(userId, projectId, path);
    if (!existing.has(path)) continue; // 사라진 파일은 건너뛴다
    targets.push({
      id: path,
      label: restoreFilename(path.split("/").pop() ?? path),
    });
  }

  const prelude: { level: "info" | "system"; text: string }[] =
    targets.length === 0
      ? [{ level: "system", text: "수합할 새 파일 없음 — 매칭만 진행합니다." }]
      : [{ level: "info", text: `수합 대상 ${targets.length}개 파일` }];
  return { targets, prelude };
}

// 파일 1개를 수합한다(다운로드 → 파싱/OCR → persistSubmission). throw하지 않고
// { ok, message }로 결과를 돌려준다(서킷 브레이커는 ok:false만 실패로 센다).
// mapping은 교사가 확정한 열 인덱스뿐 — 내용 주입이 아니다(기존 신뢰 수준 동일).
export async function ingestOneFile(
  projectId: string,
  path: string,
  mapping?: ColumnMapping,
): Promise<{ ok: boolean; message: string }> {
  try {
    const { userId, supabase } = await requireProjectOwner(projectId);
    assertOwnedPath(userId, projectId, path);
    const filename = restoreFilename(path.split("/").pop() ?? path);
    const kind = fileKind(filename);

    if (kind === "spreadsheet") {
      if (!mapping) return { ok: false, message: "열 매핑이 필요합니다" };
      const { data, isCsv } = await parseSheet(supabase, path, filename);
      const sourceType: SubmissionSourceType = isCsv ? "csv" : "xlsx";
      const summary: IngestSummary = {
        inserted: 0,
        skipped: 0,
        updatePending: 0,
        errors: [],
      };
      const cell = (row: string[], idx: number | null) =>
        idx != null ? (row[idx] ?? "").trim() : "";

      for (let i = 0; i < data.rows.length; i++) {
        const row = data.rows[i];
        const rawStudentNo = cell(row, mapping.studentNo) || null;
        const rawStudentName = cell(row, mapping.studentName) || null;
        const submissionId = cell(row, mapping.submissionId);
        const content = cell(row, mapping.content);
        if (!content) continue; // 내용이 없는 행은 제출물로 만들지 않는다.

        const submissionKey = submissionId || `${filename}#row${i + 1}`;
        try {
          const result = await persistSubmission(supabase, {
            projectId,
            submissionKey,
            rawStudentNo,
            rawStudentName,
            sourceFilename: filename,
            storagePath: path,
            sourceType,
            text: content,
          });
          tally(summary, result);
        } catch (e) {
          summary.errors.push({
            filename: `${filename} (${i + 1}행)`,
            message: e instanceof Error ? e.message : "알 수 없는 오류",
          });
        }
      }
      const errPart =
        summary.errors.length > 0 ? ` · 오류 ${summary.errors.length}` : "";
      return {
        ok: true,
        message: `${data.rows.length}행 → 신규 ${summary.inserted} · 중복 ${summary.skipped} · 변경 대기 ${summary.updatePending}${errPart}`,
      };
    }

    const routing = await loadRouting(supabase, projectId);
    const bytes = await downloadBytes(supabase, path);
    let text = "";
    let sourceType: SubmissionSourceType;

    if (kind === "docx") {
      text = await parseDocx(bytes);
      sourceType = "docx";
    } else if (kind === "pdf") {
      const { text: layer, pages } = await parsePdfText(bytes);
      if (isLikelyScan(layer, pages)) {
        text = await ocrExtract(userId, routing, {
          type: "document",
          mediaType: "application/pdf",
          dataBase64: Buffer.from(bytes).toString("base64"),
          filename,
        });
        sourceType = "pdf_scan";
      } else {
        text = layer;
        sourceType = "pdf_text";
      }
    } else if (kind === "image") {
      text = await ocrExtract(userId, routing, {
        type: "image",
        mediaType: imageMediaType(filename),
        dataBase64: Buffer.from(bytes).toString("base64"),
      });
      sourceType = "image";
    } else {
      return { ok: false, message: "지원하지 않는 파일 형식입니다." };
    }

    const result = await persistSubmission(supabase, {
      projectId,
      submissionKey: filename,
      rawStudentNo: null,
      rawStudentName: null,
      sourceFilename: filename,
      storagePath: path,
      sourceType,
      text,
    });
    const label =
      result === "inserted"
        ? `신규(${sourceType})`
        : result === "skipped"
          ? "중복 스킵"
          : "변경 대기";
    return { ok: true, message: label };
  } catch (e) {
    return {
      ok: false,
      message: (e instanceof Error ? e.message : "처리 중 오류").slice(0, 300),
    };
  }
}

export async function finalizeIngest(
  projectId: string,
  counts: { succeeded: number; failed: number },
): Promise<string> {
  await requireProjectOwner(projectId);
  revalidatePath(`/projects/${projectId}`);
  return `수합 완료 — 성공 ${counts.succeeded}·실패 ${counts.failed}`;
}

// ── 스프레드시트: 헤더 미리보기 + LLM 초기 열 추천 ───────────────────
export type SpreadsheetPreview = {
  headers: string[];
  sampleRows: string[][];
  suggested: ColumnMapping;
};

function heuristicMapping(headers: string[]): ColumnMapping {
  const find = (keywords: string[]) => {
    const i = headers.findIndex((h) =>
      keywords.some((k) => h.toLowerCase().includes(k)),
    );
    return i >= 0 ? i : null;
  };
  return {
    studentNo: find(["학번", "번호", "student", "no"]),
    studentName: find(["이름", "성명", "name"]),
    submissionId: find(["제출물", "과제", "id", "번호"]),
    content: find(["내용", "답안", "응답", "본문", "content", "text"]),
  };
}

function clampIndex(v: unknown, len: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < len ? n : null;
}

async function suggestMapping(
  userId: string,
  routing: ModelRouting,
  headers: string[],
): Promise<ColumnMapping> {
  const prompt =
    "다음은 학생 제출물 스프레드시트의 열 헤더 목록이다(0부터 시작하는 인덱스).\n" +
    headers.map((h, i) => `${i}: ${h}`).join("\n") +
    '\n\n각 역할에 해당하는 열 인덱스를 JSON으로만 답하라. 해당 열이 없으면 null.\n' +
    '{"studentNo": <학번 열>, "studentName": <이름 열>, "submissionId": <제출물ID/과제ID 열>, "content": <제출 내용/답안 열>}';
  const res = await callLLM({
    userId,
    purpose: "추출",
    modelRouting: routing,
    temperature: 0,
    maxTokens: 200,
    messages: [{ role: "user", content: prompt }],
  });
  const match = res.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("추천 파싱 실패");
  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    studentNo: clampIndex(parsed.studentNo, headers.length),
    studentName: clampIndex(parsed.studentName, headers.length),
    submissionId: clampIndex(parsed.submissionId, headers.length),
    content: clampIndex(parsed.content, headers.length),
  };
}

async function parseSheet(
  supabase: Client,
  storagePath: string,
  filename: string,
): Promise<{ data: SpreadsheetData; isCsv: boolean }> {
  const bytes = await downloadBytes(supabase, storagePath);
  const isCsv = filename.toLowerCase().endsWith(".csv");
  const data = isCsv
    ? parseCsv(new TextDecoder().decode(bytes))
    : parseXlsx(bytes);
  return { data, isCsv };
}

export async function previewSpreadsheet(
  projectId: string,
  storagePath: string,
  filename: string,
): Promise<SpreadsheetPreview> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const { data } = await parseSheet(supabase, storagePath, filename);

  let suggested = heuristicMapping(data.headers);
  try {
    const routing = await loadRouting(supabase, projectId);
    suggested = await suggestMapping(userId, routing, data.headers);
  } catch {
    // LLM 추천 실패 시 휴리스틱 추천으로 폴백 (교사가 확정하므로 안전).
  }

  return {
    headers: data.headers,
    sampleRows: data.rows.slice(0, 5),
    suggested,
  };
}

