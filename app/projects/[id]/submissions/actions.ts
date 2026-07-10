"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireProjectOwner } from "@/lib/projects";
import { callLLM } from "@/lib/llm";
import type { ModelRouting } from "@/lib/llm";
import {
  classifyMatch,
  deriveIdentityFromFilename,
  type IdentitySource,
  type StudentRef,
} from "@/lib/matching";
import { deleteOriginalObject } from "@/lib/originals";
import { writeAuditLog } from "@/lib/audit";
import { normalizeText, sha256Hex } from "@/lib/parsing";
import type { Database, SubmissionSourceType } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

async function loadRouting(supabase: Client, projectId: string): Promise<ModelRouting> {
  const { data, error } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  if (error || !data) throw new Error("프로젝트 라우팅을 불러오지 못했습니다.");
  return data.model_routing;
}

// ── 매칭 실행 (SPEC 5.2, 재실행 안전 — unmatched만 처리) ─────────────
//
// 식별값 확보 순서: 스프레드시트 열 → 파일명×명단 교차 대조 → LLM 문서 추출.
// 그 다음 classifyMatch로 자동/대기를 가른다. 자동은 "명단과 모호하지 않게 일치"할 때만.

const SPREADSHEET_TYPES: ReadonlySet<SubmissionSourceType> = new Set(["xlsx", "csv"]);

// LLM 추출은 파일 1건당 1회 호출이다. 한 번의 실행이 서버리스 타임아웃에 걸리지 않도록
// 상한을 두고, 남은 건수는 요약에 알려 재실행을 유도한다.
const LLM_BUDGET_PER_RUN = 20;
const LLM_CONCURRENCY = 4;

export type MatchingSummary = {
  autoNumber: number; // 학번 일치 자동 귀속
  autoName: number; // 이름 유일 일치 자동 귀속
  newStudents: number; // 신규 학번으로 자동 생성된 학생
  pending: number; // 확인 대기 큐로 보낸 건수
  fromFilename: number; // 파일명에서 식별값을 얻은 건수
  fromLlm: number; // LLM 추출로 식별값을 얻은 건수
  llmRemaining: number; // 상한 초과로 이번에 처리하지 못한 건수
};

type PendingSub = {
  id: string;
  raw_student_no: string | null;
  raw_student_name: string | null;
  source_type: SubmissionSourceType;
  source_filename: string | null;
  identity_source: IdentitySource | null;
};

type Identity = {
  no: string | null;
  name: string | null;
  source: IdentitySource | null;
};

// 동시성 제한 map — LLM 호출을 4개씩 굴린다.
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// 문서 앞부분을 읽어 명단의 학생 한 명을 지목한다. 명단에 없는 응답은 버린다(환각 방지).
async function extractIdentityByLLM(
  supabase: Client,
  projectId: string,
  userId: string,
  routing: ModelRouting,
  submissionId: string,
  roster: StudentRef[],
): Promise<StudentRef | null> {
  const { data: sub } = await supabase
    .from("submissions")
    .select("content_text")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!sub?.content_text) return null;

  const rosterText = roster
    .map((s) => `${s.id} | 학번:${s.student_number ?? "-"} | 이름:${s.name}`)
    .join("\n");
  const prompt =
    "아래는 한 학급의 학생 명단과, 누가 제출했는지 알 수 없는 제출물의 앞부분이다.\n" +
    "이 제출물을 **작성한 학생**을 명단에서 한 명 고르라.\n" +
    "- 근거는 작성자 식별 정보(이름란·학번란·머리말·서명)에 한정한다.\n" +
    "- 본문에 언급된 다른 사람 이름(모둠원·인용된 인물·교사)은 근거가 아니다.\n" +
    "- 조금이라도 확실하지 않으면 null을 반환한다.\n" +
    'JSON 객체만 출력하라: {"student_id": "<명단의 id>"} 또는 {"student_id": null}\n\n' +
    `[학생 명단]\n${rosterText}\n\n[제출물 앞부분]\n${sub.content_text.slice(0, 1500)}`;

  const res = await callLLM({
    userId,
    purpose: "매칭",
    modelRouting: routing,
    temperature: 0,
    maxTokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const match = res.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const id = (parsed as Record<string, unknown>).student_id;
  if (typeof id !== "string") return null;
  return roster.find((s) => s.id === id) ?? null; // 명단에 없는 id는 무시
}

export async function runMatching(projectId: string): Promise<MatchingSummary> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const roster: StudentRef[] = students ?? [];

  const { data: subsData } = await supabase
    .from("submissions")
    .select("id, raw_student_no, raw_student_name, source_type, source_filename, identity_source")
    .eq("project_id", projectId)
    .eq("match_status", "unmatched");
  const subs: PendingSub[] = subsData ?? [];

  const summary: MatchingSummary = {
    autoNumber: 0,
    autoName: 0,
    newStudents: 0,
    pending: 0,
    fromFilename: 0,
    fromLlm: 0,
    llmRemaining: 0,
  };

  // 1단계 — 결정적 식별값 확보 (열 → 파일명×명단).
  const identities = new Map<string, Identity>();
  const needsLlm: PendingSub[] = [];

  for (const sub of subs) {
    const no = sub.raw_student_no?.trim() || null;
    const name = sub.raw_student_name?.trim() || null;

    if (no || name) {
      // 이미 식별값이 있다. 출처는 기록된 값 우선, 없으면 스프레드시트 열로 본다(0011 이전 행).
      const source =
        sub.identity_source ?? (SPREADSHEET_TYPES.has(sub.source_type) ? "column" : null);
      identities.set(sub.id, { no, name, source });
      continue;
    }

    const derived = deriveIdentityFromFilename(sub.source_filename, roster);
    if (derived.studentNo || derived.studentName) {
      identities.set(sub.id, {
        no: derived.studentNo,
        name: derived.studentName,
        source: "filename",
      });
      summary.fromFilename += 1;
      continue;
    }

    needsLlm.push(sub);
  }

  // 2단계 — 남은 건은 LLM으로 추출 (상한·동시성 제한). 명단이 없으면 건너뛴다.
  const llmTargets = roster.length > 0 ? needsLlm.slice(0, LLM_BUDGET_PER_RUN) : [];
  summary.llmRemaining = needsLlm.length - llmTargets.length;

  if (llmTargets.length > 0) {
    const routing = await loadRouting(supabase, projectId);
    const found = await mapPool(llmTargets, LLM_CONCURRENCY, (sub) =>
      extractIdentityByLLM(supabase, projectId, userId, routing, sub.id, roster).catch(
        () => null, // 한 건의 LLM 실패가 전체 매칭을 막지 않는다 — 그 건은 확인 큐로 간다.
      ),
    );
    llmTargets.forEach((sub, i) => {
      const student = found[i];
      if (!student) return;
      identities.set(sub.id, {
        no: student.student_number,
        name: student.name,
        source: "llm",
      });
      summary.fromLlm += 1;
    });
  }

  // 3단계 — 분류 후 반영.
  for (const sub of subs) {
    const identity = identities.get(sub.id) ?? { no: null, name: null, source: null };
    const { no, name, source } = identity;

    const byNumber = no ? (roster.find((s) => s.student_number === no) ?? null) : null;
    const byName = name ? roster.filter((s) => s.name === name) : [];
    const outcome = classifyMatch({
      rawStudentNo: no,
      rawStudentName: name,
      byNumber,
      byName,
      identitySource: source,
    });

    // 파일명·LLM에서 얻은 식별값은 화면에 근거로 보여야 하므로 함께 저장한다.
    const derivedPatch =
      source === "filename" || source === "llm"
        ? { raw_student_no: no, raw_student_name: name }
        : {};

    if (outcome.action === "auto_existing") {
      await supabase
        .from("submissions")
        .update({
          ...derivedPatch,
          student_id: outcome.studentId,
          match_status: "auto_matched",
          match_method: outcome.method,
          identity_source: source,
        })
        .eq("id", sub.id);
      if (outcome.method === "auto_number") summary.autoNumber += 1;
      else summary.autoName += 1;
    } else if (outcome.action === "auto_new_number") {
      if (!no) continue; // classify가 보장하지만 방어적으로
      let student = roster.find((s) => s.student_number === no) ?? null;
      if (!student) {
        const { data: created, error } = await supabase
          .from("students")
          .insert({ project_id: projectId, student_number: no, name: name || `학번 ${no}` })
          .select("id, student_number, name")
          .single();
        if (error) {
          // 동시 실행 등으로 이미 생성됐을 수 있음 → 재조회
          const { data: again } = await supabase
            .from("students")
            .select("id, student_number, name")
            .eq("project_id", projectId)
            .eq("student_number", no)
            .maybeSingle();
          if (!again) throw new Error(error.message);
          student = again;
        } else {
          student = created;
          roster.push(created);
          summary.newStudents += 1;
        }
      }
      await supabase
        .from("submissions")
        .update({
          student_id: student.id,
          match_status: "auto_matched",
          match_method: "auto_new_number",
          identity_source: source,
        })
        .eq("id", sub.id);
      summary.autoNumber += 1;
    } else {
      await supabase
        .from("submissions")
        .update({
          ...derivedPatch,
          match_status: "pending_confirm",
          match_candidates: outcome.candidates,
          identity_source: source,
        })
        .eq("id", sub.id);
      summary.pending += 1;
    }
  }

  revalidatePath(`/projects/${projectId}/submissions`);
  return summary;
}

// ── 재귀속 (SPEC 5.4) — 자동 귀속의 오류를 교사가 사후에 바로잡는 경로 ──
export async function reassignSubmission(
  projectId: string,
  submissionId: string,
  studentId: string,
) {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const { data: target } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!target) throw new Error("해당 프로젝트의 학생이 아닙니다.");

  const { data: sub } = await supabase
    .from("submissions")
    .select("student_id")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!sub) throw new Error("제출물을 찾을 수 없습니다.");
  if (sub.student_id === studentId) return; // 변화 없음

  const { error } = await supabase
    .from("submissions")
    .update({
      student_id: studentId,
      match_status: "confirmed",
      match_method: "reassigned",
      match_candidates: null,
    })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  // 혼입을 되돌린 기록은 남겨야 한다. needs_recalc 배지는 DB 트리거가 세운다.
  await writeAuditLog({
    actorId: userId,
    action: "submission.reassign",
    entity: "submissions",
    entityId: submissionId,
    detail: { from_student_id: sub.student_id, to_student_id: studentId },
  });
  revalidatePath(`/projects/${projectId}/submissions`);
}

// ── LLM 후보 제안 (지연 실행, 자동 반영 금지) ───────────────────────
export type LlmCandidate = {
  student_id: string | null;
  name: string;
  student_number: string | null;
  reason: string;
};

export async function suggestMatchCandidates(
  projectId: string,
  submissionId: string,
): Promise<LlmCandidate[]> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const { data: sub } = await supabase
    .from("submissions")
    .select("content_text")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!sub) throw new Error("제출물을 찾을 수 없습니다.");

  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const roster = students ?? [];
  if (roster.length === 0) return [];

  const routing = await loadRouting(supabase, projectId);
  const roster_text = roster
    .map((s) => `${s.id} | 학번:${s.student_number ?? "-"} | 이름:${s.name}`)
    .join("\n");
  const prompt =
    "아래 학생 명단과 제출물 내용을 보고, 이 제출물이 어느 학생의 것인지 후보를 제안하라. " +
    "확실하지 않으면 빈 배열. 추측은 근거와 함께. JSON 배열로만 답하라: " +
    '[{"student_id": "<명단의 id>", "reason": "<근거>"}]\n\n' +
    `[학생 명단]\n${roster_text}\n\n[제출물 내용(발췌)]\n${sub.content_text.slice(0, 2000)}`;

  const res = await callLLM({
    userId,
    purpose: "매칭",
    modelRouting: routing,
    temperature: 0,
    maxTokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const match = res.text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: LlmCandidate[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const student = roster.find((s) => s.id === rec.student_id);
    if (!student) continue; // 명단에 없는 id는 무시(환각 방지)
    out.push({
      student_id: student.id,
      name: student.name,
      student_number: student.student_number,
      reason: typeof rec.reason === "string" ? rec.reason : "",
    });
  }
  return out;
}

// ── 확인 큐 확정 ────────────────────────────────────────────────────
export async function attributeExisting(
  projectId: string,
  submissionId: string,
  studentId: string,
) {
  const { supabase } = await requireProjectOwner(projectId);
  const { data: st } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!st) throw new Error("해당 프로젝트의 학생이 아닙니다.");

  const { error } = await supabase
    .from("submissions")
    .update({
      student_id: studentId,
      match_status: "confirmed",
      match_method: "confirmed_existing",
      match_candidates: null,
    })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

export async function attributeNew(
  projectId: string,
  submissionId: string,
  name: string,
  studentNumber: string | null,
) {
  const { supabase } = await requireProjectOwner(projectId);
  const cleanName = name.trim();
  const cleanNo = studentNumber?.trim() || null;
  if (!cleanName) throw new Error("학생 이름을 입력하세요.");

  // 학번이 있으면 find-or-create, 없으면 새 학생 생성.
  let studentId: string | null = null;
  if (cleanNo) {
    const { data: existing } = await supabase
      .from("students")
      .select("id")
      .eq("project_id", projectId)
      .eq("student_number", cleanNo)
      .maybeSingle();
    studentId = existing?.id ?? null;
  }
  if (!studentId) {
    const { data: created, error } = await supabase
      .from("students")
      .insert({ project_id: projectId, name: cleanName, student_number: cleanNo })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("이미 존재하는 학번입니다.");
      throw new Error(error.message);
    }
    studentId = created.id;
  }

  const { error } = await supabase
    .from("submissions")
    .update({
      student_id: studentId,
      match_status: "confirmed",
      match_method: "confirmed_new",
      match_candidates: null,
    })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

// ── update_pending 해소 (SPEC 5.1, 수용 4) ──────────────────────────
type PendingContent = { content_text: string; content_hash: string };

async function loadPending(
  supabase: Client,
  projectId: string,
  submissionId: string,
): Promise<{ student_id: string | null; pending: PendingContent | null }> {
  const { data } = await supabase
    .from("submissions")
    .select("student_id, pending_content")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) throw new Error("제출물을 찾을 수 없습니다.");
  const pc = data.pending_content as PendingContent | null;
  return { student_id: data.student_id, pending: pc };
}

export async function acceptPendingContent(projectId: string, submissionId: string) {
  const { supabase } = await requireProjectOwner(projectId);
  const { student_id, pending } = await loadPending(supabase, projectId, submissionId);
  if (!pending) throw new Error("반영할 변경 내용이 없습니다.");
  const { error } = await supabase
    .from("submissions")
    .update({
      content_text: pending.content_text,
      content_hash: pending.content_hash,
      pending_content: null,
      match_status: student_id ? "confirmed" : "unmatched",
    })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

export async function rejectPendingContent(projectId: string, submissionId: string) {
  const { supabase } = await requireProjectOwner(projectId);
  const { student_id } = await loadPending(supabase, projectId, submissionId);
  const { error } = await supabase
    .from("submissions")
    .update({ pending_content: null, match_status: student_id ? "confirmed" : "unmatched" })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

// ── 제출물 상세 조작 (SPEC 5.4) ─────────────────────────────────────
export async function toggleInclude(
  projectId: string,
  submissionId: string,
  field: "eval" | "record",
  value: boolean,
) {
  const { supabase } = await requireProjectOwner(projectId);
  const patch =
    field === "eval" ? { include_in_eval: value } : { include_in_record: value };
  const { error } = await supabase
    .from("submissions")
    .update(patch)
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  // 자동 저장이므로 revalidate 생략(동일 값 재로드 방지).
}

export async function updateSubmissionText(
  projectId: string,
  submissionId: string,
  text: string,
) {
  const { supabase } = await requireProjectOwner(projectId);
  const content_text = normalizeText(text);
  const { error } = await supabase
    .from("submissions")
    .update({ content_text, content_hash: sha256Hex(content_text) })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

export async function deleteSubmission(projectId: string, submissionId: string) {
  const { supabase } = await requireProjectOwner(projectId);
  const { error } = await supabase
    .from("submissions")
    .delete()
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

export async function addManualSubmission(
  projectId: string,
  studentId: string,
  text: string,
) {
  const { supabase } = await requireProjectOwner(projectId);
  const { data: st } = await supabase
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!st) throw new Error("해당 프로젝트의 학생이 아닙니다.");
  const content_text = normalizeText(text);
  if (!content_text) throw new Error("내용을 입력하세요.");

  const { error } = await supabase.from("submissions").insert({
    project_id: projectId,
    student_id: studentId,
    content_text,
    content_hash: sha256Hex(content_text),
    source_type: "manual",
    submission_key: `manual-${randomUUID()}`,
    match_status: "confirmed",
    match_method: "manual",
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

// ── 추출 승인 → 원본 삭제 (INV-5) ───────────────────────────────────
export async function approveExtraction(projectId: string, submissionId: string) {
  const { supabase } = await requireProjectOwner(projectId);
  const { error } = await supabase
    .from("submissions")
    .update({ extraction_approved_at: new Date().toISOString() })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}

export async function deleteOriginal(projectId: string, submissionId: string) {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const { data: sub } = await supabase
    .from("submissions")
    .select("storage_path, extraction_approved_at")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!sub) throw new Error("제출물을 찾을 수 없습니다.");
  // INV-5: 추출 승인 전에는 절대 삭제하지 않는다.
  if (!sub.extraction_approved_at) {
    throw new Error("추출 확인(승인) 후에만 원본을 삭제할 수 있습니다.");
  }
  if (!sub.storage_path) return; // 이미 삭제됨 또는 원본 없음(수동)

  await deleteOriginalObject(supabase, sub.storage_path, submissionId);
  const { error } = await supabase
    .from("submissions")
    .update({ storage_path: null })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId: userId,
    action: "original_file.delete",
    entity: "submissions",
    entityId: submissionId,
    detail: { reason: "manual" },
  });
  revalidatePath(`/projects/${projectId}/submissions`);
}
