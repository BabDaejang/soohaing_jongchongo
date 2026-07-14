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
  type PendingReason,
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

type PendingSub = {
  id: string;
  raw_student_no: string | null;
  raw_student_name: string | null;
  source_type: SubmissionSourceType;
  source_filename: string | null;
  submission_key: string | null;
  identity_source: IdentitySource | null;
};

type Identity = {
  no: string | null;
  name: string | null;
  source: IdentitySource | null;
};

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

// 제출물 라벨: 파일명 → 제출물키 → id 앞 8자.
function labelForSub(sub: {
  source_filename: string | null;
  submission_key: string | null;
  id: string;
}): string {
  return sub.source_filename ?? sub.submission_key ?? sub.id.slice(0, 8);
}

// 식별값 출처를 사람이 읽을 말로.
function sourceLabel(source: IdentitySource | null): string {
  if (source === "column") return "열";
  if (source === "filename") return "파일명";
  if (source === "llm") return "LLM 추정";
  return "미상";
}

// 확인 큐로 보낸 사유를 사람이 읽을 말로 (classifyMatch의 PendingReason).
function pendingLabel(reason: PendingReason, candidateCount: number): string {
  switch (reason) {
    case "name":
      return candidateCount >= 2 ? `동명이인 ${candidateCount}명` : "명단 미일치";
    case "number_conflict":
      return "학번 오타 의심";
    case "number_unknown":
      return "학번 명단 미등록";
    case "none":
      return "식별 불가";
  }
}

// classifyMatch → DB 반영. 자동 귀속(신규 학생 생성 포함)·큐행을 한 건 처리하고,
// 사람이 읽을 결과 문구를 돌려준다. roster는 신규 학생 생성 시 제자리 갱신된다
// (같은 실행 안에서 뒤따르는 건이 방금 만든 학생을 다시 만들지 않도록).
async function applyClassification(
  supabase: Client,
  projectId: string,
  roster: StudentRef[],
  sub: PendingSub,
  identity: Identity,
): Promise<{ auto: boolean; resultText: string }> {
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
    const who = roster.find((s) => s.id === outcome.studentId)?.name ?? "학생";
    const how = outcome.method === "auto_number" ? "학번 자동" : "이름 자동";
    return { auto: true, resultText: `${who} (${sourceLabel(source)}·${how})` };
  }

  if (outcome.action === "auto_new_number") {
    if (!no) {
      // classify가 보장하지만 방어적으로 — 큐로 보낸다.
      await supabase
        .from("submissions")
        .update({ match_status: "pending_confirm", identity_source: source })
        .eq("id", sub.id);
      return { auto: false, resultText: "확인 큐(식별 불가)" };
    }
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
    return { auto: true, resultText: `${student.name} (신규 학생 자동 생성)` };
  }

  // pending — 확인 대기 큐.
  await supabase
    .from("submissions")
    .update({
      ...derivedPatch,
      match_status: "pending_confirm",
      match_candidates: outcome.candidates,
      identity_source: source,
    })
    .eq("id", sub.id);
  return {
    auto: false,
    resultText: `확인 큐(${pendingLabel(outcome.reason, outcome.candidates.length)})`,
  };
}

// ── 매칭 실행 — 클라이언트 구동 1건 단위(prepare → matchOneByLlm × N → finalize) ──
// 전건을 한 서버 액션에서 돌리며 LLM 상한(20건)을 두던 이전 구조는 진행 표시·중단이
// 불가했다. 결정적(열·파일명) 처리는 prepare에서 한 번에 끝내고, LLM 추정이 필요한
// 건만 실행 터미널(useSequentialRun)이 1건씩 호출한다 → 상한 소멸.

// 결정적으로 처리 가능한 건(열·파일명 식별값)을 즉시 반영하고, LLM 추정이 필요한
// 건 목록을 돌려준다. revalidatePath는 finalize에서만.
export async function prepareMatching(projectId: string): Promise<{
  prelude: { level: "ok" | "info" | "system"; text: string }[];
  llmTargets: { id: string; label: string }[];
}> {
  const { supabase } = await requireProjectOwner(projectId);

  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const roster: StudentRef[] = students ?? [];

  const { data: subsData } = await supabase
    .from("submissions")
    .select(
      "id, raw_student_no, raw_student_name, source_type, source_filename, submission_key, identity_source",
    )
    .eq("project_id", projectId)
    .eq("match_status", "unmatched");
  const subs: PendingSub[] = subsData ?? [];

  const prelude: { level: "ok" | "info" | "system"; text: string }[] = [];
  const llmTargets: { id: string; label: string }[] = [];

  // 1단계 — 결정적 식별값 확보 (열 → 파일명×명단, **원본 명단** 기준).
  // 파일명 대조를 먼저 전부 끝낸 뒤 반영하므로, 반영 중 만들어진 학생이 대조에 끼어들지 않는다.
  const identities = new Map<string, Identity>();
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
      continue;
    }

    // 결정적으로 못 찾음 → LLM 추정 대상(명단이 있을 때만 — 대조할 명단이 없으면 무의미).
    if (roster.length > 0) llmTargets.push({ id: sub.id, label: labelForSub(sub) });
  }

  // 2단계 — 결정적 식별값을 가진 건만 분류·반영. LLM 대상은 matchOneByLlm이 나중에.
  let auto = 0;
  let pending = 0;
  for (const sub of subs) {
    const identity = identities.get(sub.id);
    if (!identity) continue;
    const { auto: isAuto, resultText } = await applyClassification(
      supabase,
      projectId,
      roster,
      sub,
      identity,
    );
    prelude.push({ level: isAuto ? "ok" : "info", text: `${labelForSub(sub)} → ${resultText}` });
    if (isAuto) auto += 1;
    else pending += 1;
  }

  // 요약·안내.
  if (subs.length === 0) {
    prelude.push({ level: "system", text: "매칭할 미매칭 제출물이 없습니다." });
  } else {
    prelude.push({
      level: "info",
      text: `결정적 처리 ${auto + pending}건 (자동 ${auto} · 확인 큐 ${pending}) · LLM 추정 대상 ${llmTargets.length}건`,
    });
    if (roster.length === 0) {
      prelude.push({
        level: "system",
        text: "학생 명단이 비어 있어 파일명·LLM 매칭을 건너뜁니다. 학생 명단을 먼저 등록하세요.",
      });
    }
  }

  return { prelude, llmTargets };
}

// 제출물 1건을 LLM 추정으로 처리(터미널이 반복 호출). 자동 귀속·큐행 모두 ok:true,
// 진짜 오류(LLM·DB)만 ok:false — 서킷 브레이커는 이것만 센다.
// 클라이언트 입력은 id뿐 — 명단·라우팅은 서버가 DB에서 재조립한다(INV-2).
export async function matchOneByLlm(
  projectId: string,
  submissionId: string,
): Promise<{ ok: boolean; message: string }> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const roster: StudentRef[] = students ?? [];

  // 소속·상태 재확인(다른 프로젝트·이미 처리된 건 차단, 동시 실행 방어).
  const { data: subData } = await supabase
    .from("submissions")
    .select(
      "id, raw_student_no, raw_student_name, source_type, source_filename, submission_key, identity_source, match_status",
    )
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!subData) return { ok: false, message: "제출물을 찾을 수 없습니다." };
  if (subData.match_status !== "unmatched") {
    return { ok: true, message: "→ 이미 처리됨" };
  }
  const sub: PendingSub = subData;

  // LLM 추출 — 명단의 학생 한 명 지목(환각 응답은 버림).
  let student: StudentRef | null;
  try {
    const routing = await loadRouting(supabase, projectId);
    student = await extractIdentityByLLM(
      supabase,
      projectId,
      userId,
      routing,
      submissionId,
      roster,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM 호출 실패";
    return { ok: false, message: msg.slice(0, 300) };
  }

  const identity: Identity = student
    ? { no: student.student_number, name: student.name, source: "llm" }
    : { no: null, name: null, source: null };

  try {
    const { resultText } = await applyClassification(
      supabase,
      projectId,
      roster,
      sub,
      identity,
    );
    return { ok: true, message: `→ ${resultText}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "DB 반영 실패";
    return { ok: false, message: msg.slice(0, 300) };
  }
}

// 실행 종료 후 1회: 목록 재조회를 위해 revalidate만. 매칭은 재계산·감사 로그 없음(기존과 동일).
export async function finalizeMatching(projectId: string): Promise<null> {
  await requireProjectOwner(projectId);
  revalidatePath(`/projects/${projectId}/submissions`);
  return null;
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

  // 임시 분할 페이지 파일 정리
  await cleanupTemporaryPage(supabase, projectId, submissionId);

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

  // 임시 분할 페이지 파일 정리
  await cleanupTemporaryPage(supabase, projectId, submissionId);

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

  // 임시 분할 페이지 파일 정리
  const { data: sub } = await supabase
    .from("submissions")
    .select("storage_path")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (sub?.storage_path && sub.storage_path.includes("/temp_")) {
    await supabase.storage.from("originals").remove([sub.storage_path]);
  }

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

// ── 임시 분할 페이지 파일 정리 및 signed URL 생성 ───────────────────────

async function cleanupTemporaryPage(
  supabase: Client,
  projectId: string,
  submissionId: string,
) {
  const { data: sub } = await supabase
    .from("submissions")
    .select("storage_path")
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (sub?.storage_path && sub.storage_path.includes("/temp_")) {
    await supabase.storage.from("originals").remove([sub.storage_path]);
    await supabase
      .from("submissions")
      .update({ storage_path: null })
      .eq("id", submissionId)
      .eq("project_id", projectId);
  }
}

export async function getSignedFileUrl(projectId: string, path: string): Promise<string> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  if (!path.startsWith(`${userId}/${projectId}/`)) {
    throw new Error("접근할 수 없는 파일 경로입니다.");
  }
  const { data, error } = await supabase.storage.from("originals").createSignedUrl(path, 60 * 15);
  if (error || !data?.signedUrl) {
    throw new Error(`임시 링크 생성 실패: ${error?.message}`);
  }
  return data.signedUrl;
}

export async function deleteSubmissionsByFile(projectId: string, filename: string) {
  const { supabase } = await requireProjectOwner(projectId);
  
  // 임시 분할 파일들이 스토리지에 있으면 일괄 제거
  const { data: subs } = await supabase
    .from("submissions")
    .select("storage_path")
    .eq("project_id", projectId)
    .eq("source_filename", filename);
    
  const pathsToDelete = (subs ?? [])
    .map((s) => s.storage_path)
    .filter((p): p is string => !!p && p.includes("/temp_"));
    
  if (pathsToDelete.length > 0) {
    await supabase.storage.from("originals").remove(pathsToDelete);
  }

  // 데이터베이스에서 해당 파일명을 소스로 가지는 제출물 일괄 삭제
  const { error } = await supabase
    .from("submissions")
    .delete()
    .eq("project_id", projectId)
    .eq("source_filename", filename);
    
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/submissions`);
}
