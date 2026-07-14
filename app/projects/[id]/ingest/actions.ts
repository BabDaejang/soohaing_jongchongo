"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
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

  // 수합 완료된 원본 삭제 허용: DB 텍스트는 살리고 storage_path만 null로 갱신
  const { error: updateError } = await supabase
    .from("submissions")
    .update({ storage_path: null })
    .eq("project_id", projectId)
    .eq("storage_path", path);
  if (updateError) throw new Error(updateError.message);

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

      const contentItems = Array.isArray(mapping.content)
        ? mapping.content
        : typeof mapping.content === "number"
          ? [{ index: mapping.content, label: filename }]
          : [];

      for (let i = 0; i < data.rows.length; i++) {
        const row = data.rows[i];
        const rawStudentNo = cell(row, mapping.studentNo) || null;
        const rawStudentName = cell(row, mapping.studentName) || null;
        const submissionId = cell(row, mapping.submissionId);

        for (const colItem of contentItems) {
          const colIdx = colItem.index;
          const colLabel = colItem.label || `열 ${colIdx}`;
          const content = (row[colIdx] ?? "").trim();
          if (!content) continue; // 내용이 없는 행은 제출물로 만들지 않는다.

          const submissionKey = `${colLabel}::${submissionId || `${filename}#row${i + 1}`}`;
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
              filename: `${filename} (${i + 1}행 · ${colLabel})`,
              message: e instanceof Error ? e.message : "알 수 없는 오류",
            });
          }
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
      if (pages > 1) {
        // 다인용 PDF: 페이지 단위 분할 및 맥락 기반 수합 진행
        return await ingestMultiPagePdf(projectId, userId, supabase, path, filename, bytes, layer, pages);
      }
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
  const contentIdx = find(["내용", "답안", "응답", "본문", "content", "text"]);
  return {
    studentNo: find(["학번", "번호", "student", "no"]),
    studentName: find(["이름", "성명", "name"]),
    submissionId: find(["제출물", "과제", "id", "번호"]),
    content:
      contentIdx !== null
        ? [{ index: contentIdx, label: headers[contentIdx] || `열 ${contentIdx}` }]
        : [],
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
  const contentIdx = clampIndex(parsed.content, headers.length);
  return {
    studentNo: clampIndex(parsed.studentNo, headers.length),
    studentName: clampIndex(parsed.studentName, headers.length),
    submissionId: clampIndex(parsed.submissionId, headers.length),
    content:
      contentIdx !== null
        ? [{ index: contentIdx, label: headers[contentIdx] || `열 ${contentIdx}` }]
        : [],
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

// ── 다인용 PDF 분리 및 맥락 매칭 헬퍼 ───────────────────────────────────

async function splitPdfPages(pdfBytes: Uint8Array): Promise<Uint8Array[]> {
  const srcDoc = await PDFDocument.load(pdfBytes);
  const pageCount = srcDoc.getPageCount();
  const pagesBytes: Uint8Array[] = [];
  for (let i = 0; i < pageCount; i++) {
    const newDoc = await PDFDocument.create();
    const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(copiedPage);
    const bytes = await newDoc.save();
    pagesBytes.push(bytes);
  }
  return pagesBytes;
}

async function ingestMultiPagePdf(
  projectId: string,
  userId: string,
  supabase: Client,
  path: string,
  filename: string,
  bytes: Uint8Array,
  layerText: string,
  totalPages: number,
): Promise<{ ok: boolean; message: string }> {
  try {
    const pageBytesList = await splitPdfPages(bytes);
    const routing = await loadRouting(supabase, projectId);

    const pagesData: { pageNum: number; text: string; isScan: boolean }[] = [];
    for (let i = 0; i < totalPages; i++) {
      const pageBytes = pageBytesList[i];
      const { text: pageLayerText } = await parsePdfText(pageBytes);
      const isScan = isLikelyScan(pageLayerText, 1);
      let pageText = "";
      if (isScan) {
        pageText = await ocrExtract(userId, routing, {
          type: "document",
          mediaType: "application/pdf",
          dataBase64: Buffer.from(pageBytes).toString("base64"),
          filename: `${filename}_page_${i + 1}.pdf`,
        });
      } else {
        pageText = pageLayerText;
      }
      pagesData.push({ pageNum: i + 1, text: pageText, isScan });
    }

    // 학생 명단 로드
    const { data: students } = await supabase
      .from("students")
      .select("id, student_number, name")
      .eq("project_id", projectId);
    const roster = students ?? [];

    let mapping: { pageNum: number; student_id: string | null; status: "matched" | "ambiguous" }[] = [];

    if (roster.length > 0) {
      const rosterText = roster
        .map((s) => `${s.id} | 학번:${s.student_number ?? "-"} | 이름:${s.name}`)
        .join("\n");

      const pagesText = pagesData
        .map((p) => `[페이지 ${p.pageNum}]\n${p.text.slice(0, 1500)}`)
        .join("\n\n=== NEXT PAGE ===\n\n");

      const prompt =
        `아래는 학생 명단과, 하나의 PDF 파일에서 분할된 각 페이지의 텍스트이다. ` +
        `이 PDF 파일은 여러 학생의 제출물이 묶인 것이다. 각 페이지가 어느 학생의 제출물인지 판정하라.\n\n` +
        `[판정 규칙]\n` +
        `1. 페이지들은 순서대로 정렬되어 있다. 한 학생의 제출물이 여러 페이지에 걸쳐 작성되었을 수 있다.\n` +
        `2. 페이지 본문에 학번이나 이름이 명시되어 있다면 해당 학생으로 귀속한다.\n` +
        `3. 페이지 본문에 학번/이름이 없더라도, 바로 이전 페이지가 '학생 A'의 제출물이었고, 내용의 흐름이 이어지거나 새로운 제출물의 시작(새로운 이름/학번)이 보이지 않는다면 해당 페이지도 '학생 A'의 제출물로 판정한다.\n` +
        `4. 만약 해당 페이지가 누구의 제출물인지 앞뒤 맥락으로도 판단하기 어렵거나 모호하다면 status를 'ambiguous'로 표시하고 student_id를 null로 하라.\n` +
        `5. 명단에 일치하는 학생이 아예 없거나 판단할 수 없다면 'ambiguous'로 표시하라.\n\n` +
        `[학생 명단]\n${rosterText}\n\n` +
        `[페이지별 텍스트]\n${pagesText}\n\n` +
        `각 페이지별 판정 결과를 다음 JSON 배열 형식으로만 답하라. 다른 설명이나 텍스트는 포함하지 말라.\n` +
        `[\n` +
        `  { "pageNum": 1, "student_id": "<학생 ID>", "status": "matched" | "ambiguous" },\n` +
        `  { "pageNum": 2, "student_id": null, "status": "ambiguous" }\n` +
        `]`;

      const res = await callLLM({
        userId,
        purpose: "매칭",
        modelRouting: routing,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      });

      const match = res.text.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          mapping = JSON.parse(match[0]);
        } catch {
          // JSON 파싱 실패 시 기본적으로 전부 모호함으로 처리
        }
      }
    }

    // mapping에 명시되지 않은 페이지는 모호함으로 처리
    const mappingMap = new Map(mapping.map((m) => [m.pageNum, m]));
    const finalMapping = pagesData.map((p) => {
      const m = mappingMap.get(p.pageNum);
      return {
        pageNum: p.pageNum,
        student_id: m?.student_id || null,
        status: m?.status || "ambiguous",
      };
    });

    // 1. 매칭된 연속된 페이지 병합 처리
    const segments: { studentId: string; pageNums: number[]; texts: string[] }[] = [];
    let currentSegment: { studentId: string; pageNums: number[]; texts: string[] } | null = null;

    for (const page of finalMapping) {
      if (page.status === "matched" && page.student_id) {
        const studentId = page.student_id;
        const pageText = pagesData.find((p) => p.pageNum === page.pageNum)?.text || "";
        if (currentSegment && currentSegment.studentId === studentId) {
          currentSegment.pageNums.push(page.pageNum);
          currentSegment.texts.push(pageText);
        } else {
          currentSegment = { studentId, pageNums: [page.pageNum], texts: [pageText] };
          segments.push(currentSegment);
        }
      } else {
        currentSegment = null;
      }
    }

    let insertedCount = 0;
    let skippedCount = 0;
    let pendingCount = 0;

    for (const seg of segments) {
      const mergedText = seg.texts.join("\n\n");
      const normalized = normalizeText(mergedText);
      const content_hash = sha256Hex(normalized);
      const submissionKey = `${filename}#pages_${seg.pageNums.join("-")}`;

      // 중복 체크 및 저장
      const { data: existing } = await supabase
        .from("submissions")
        .select("id, content_hash")
        .eq("project_id", projectId)
        .eq("submission_key", submissionKey)
        .maybeSingle();

      const decision = decideDedup(
        existing ? { id: existing.id, content_hash: existing.content_hash } : null,
        content_hash,
      );

      if (decision.action === "skip") {
        skippedCount++;
        continue;
      }

      if (decision.action === "update_pending") {
        await supabase
          .from("submissions")
          .update({
            match_status: "update_pending",
            pending_content: { content_text: normalized, content_hash },
          })
          .eq("id", decision.id);
        pendingCount++;
        continue;
      }

      const st = roster.find((s) => s.id === seg.studentId);
      const firstPage = pagesData.find((p) => p.pageNum === seg.pageNums[0]);
      const sourceType = firstPage?.isScan ? "pdf_scan" : "pdf_text";

      const { error } = await supabase.from("submissions").insert({
        project_id: projectId,
        content_text: normalized,
        content_hash,
        source_type: sourceType,
        submission_key: submissionKey,
        source_filename: filename,
        storage_path: path,
        student_id: seg.studentId,
        match_status: "auto_matched",
        match_method: "auto_name",
        identity_source: "llm",
        raw_student_no: st?.student_number ?? null,
        raw_student_name: st?.name ?? null,
      });
      if (error) throw new Error(error.message);
      insertedCount++;
    }

    // 2. 모호한 페이지 임시 저장 (단일 페이지 PDF)
    let ambiguousCount = 0;
    for (const page of finalMapping) {
      if (page.status === "ambiguous" || !page.student_id) {
        const pageBytes = pageBytesList[page.pageNum - 1];
        const pageText = pagesData.find((p) => p.pageNum === page.pageNum)?.text || "";
        const normalized = normalizeText(pageText);
        const content_hash = sha256Hex(normalized);
        const submissionKey = `${filename}#page_${page.pageNum}`;

        // 이미 생성된 임시 제출물 확인
        const { data: existing } = await supabase
          .from("submissions")
          .select("id")
          .eq("project_id", projectId)
          .eq("submission_key", submissionKey)
          .maybeSingle();

        if (existing) {
          // 이미 존재하면 스킵
          continue;
        }

        // 단일 페이지 PDF 업로드
        const tempPath = `${userId}/${projectId}/temp_${randomUUID()}__page_${page.pageNum}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("originals")
          .upload(tempPath, pageBytes, {
            contentType: "application/pdf",
            upsert: false,
          });
        if (uploadError) throw new Error(uploadError.message);

        // 임시 제출물 레코드 생성 (match_status = pending_confirm)
        const pageData = pagesData.find((p) => p.pageNum === page.pageNum);
        const isScan = pageData?.isScan ?? false;
        const sourceType = isScan ? "pdf_scan" : "pdf_text";

        const { error: insertError } = await supabase.from("submissions").insert({
          project_id: projectId,
          content_text: normalized,
          content_hash,
          source_type: sourceType,
          submission_key: submissionKey,
          source_filename: filename,
          storage_path: tempPath,
          match_status: "pending_confirm",
          student_id: null,
          raw_student_no: null,
          raw_student_name: null,
        });
        if (insertError) throw new Error(insertError.message);
        ambiguousCount++;
      }
    }

    return {
      ok: true,
      message: `다인용 PDF(${totalPages}p) 분할 수합 완료: 매칭 ${insertedCount}건 · 중복 ${skippedCount}건 · 변경 대기 ${pendingCount}건 · 확인 대기 큐 ${ambiguousCount}건`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `다인용 PDF 수합 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
    };
  }
}

