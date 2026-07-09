"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireProjectOwner } from "@/lib/projects";
import { callLLM } from "@/lib/llm";
import type { ModelRouting } from "@/lib/llm";
import { classifyMatch, type StudentRef } from "@/lib/matching";
import { deleteOriginalObject } from "@/lib/originals";
import { writeAuditLog } from "@/lib/audit";
import { normalizeText, sha256Hex } from "@/lib/parsing";
import type { Database } from "@/lib/supabase/types";

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

// ── 매칭 실행 (결정적 규칙, 재실행 안전 — unmatched만 처리) ──────────
export type MatchingSummary = {
  autoMatched: number;
  newStudents: number;
  pendingName: number;
  pendingNone: number;
};

export async function runMatching(projectId: string): Promise<MatchingSummary> {
  const { supabase } = await requireProjectOwner(projectId);

  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const roster: StudentRef[] = students ?? [];

  const { data: subs } = await supabase
    .from("submissions")
    .select("id, raw_student_no, raw_student_name")
    .eq("project_id", projectId)
    .eq("match_status", "unmatched");

  const summary: MatchingSummary = { autoMatched: 0, newStudents: 0, pendingName: 0, pendingNone: 0 };

  for (const sub of subs ?? []) {
    const no = sub.raw_student_no?.trim() || null;
    const name = sub.raw_student_name?.trim() || null;
    const byNumber = no ? (roster.find((s) => s.student_number === no) ?? null) : null;
    const byName = name ? roster.filter((s) => s.name === name) : [];
    const outcome = classifyMatch({ rawStudentNo: no, rawStudentName: name, byNumber, byName });

    if (outcome.action === "auto_existing") {
      await supabase
        .from("submissions")
        .update({ student_id: outcome.studentId, match_status: "auto_matched", match_method: outcome.method })
        .eq("id", sub.id);
      summary.autoMatched += 1;
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
        .update({ student_id: student.id, match_status: "auto_matched", match_method: "auto_new_number" })
        .eq("id", sub.id);
      summary.autoMatched += 1;
    } else {
      await supabase
        .from("submissions")
        .update({ match_status: "pending_confirm", match_candidates: outcome.candidates })
        .eq("id", sub.id);
      if (outcome.reason === "name") summary.pendingName += 1;
      else summary.pendingNone += 1;
    }
  }

  revalidatePath(`/projects/${projectId}/submissions`);
  return summary;
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
