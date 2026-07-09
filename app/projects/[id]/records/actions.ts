"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireApproved } from "@/lib/auth";
import { requireProjectOwner } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callLLM, type ModelRouting } from "@/lib/llm";
import { writeAuditLog } from "@/lib/audit";
import {
  buildStudentContext,
  createSupabaseContextSource,
} from "@/lib/records/context";
import {
  buildGenerationMessages,
  buildSentenceRegenMessages,
} from "@/lib/prompts/generation";
import { buildVerificationMessages } from "@/lib/prompts/verification";
import { buildExampleAnalysisMessages } from "@/lib/prompts/example-ingest";
import { parseVerification, countUnsupported } from "@/lib/records/verification";
import { parseSuggestions, type ProfileSuggestion } from "@/lib/records/suggestions";
import { SEED_GUIDELINES, SEED_PROHIBITIONS } from "@/lib/prompts/seed-profile";
import type {
  Database,
  ProfileItem,
  RecordOrigin,
  VerificationSentence,
} from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type Admin = ReturnType<typeof createAdminClient>;
type ProfileTarget = "account" | "project";

const UNIQUE_VIOLATION = "23505";

// ── 공용 헬퍼 ──────────────────────────────────────────────────────────
async function assertStudentInProject(
  supabase: Client,
  projectId: string,
  studentId: string,
): Promise<void> {
  const { data } = await supabase
    .from("students")
    .select("project_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!data || data.project_id !== projectId) {
    throw new Error("학생을 찾을 수 없습니다.");
  }
}

async function getRouting(
  supabase: Client,
  projectId: string,
): Promise<ModelRouting> {
  const { data } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  if (!data) throw new Error("프로젝트를 찾을 수 없습니다.");
  return data.model_routing;
}

async function nextVersionFor(
  reader: Client | Admin,
  studentId: string,
): Promise<number> {
  const { data } = await reader
    .from("records")
    .select("version")
    .eq("student_id", studentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.version ?? 0) + 1;
}

// ── 생성 (유일 진입점, 단일 studentId — INV-1) ─────────────────────────
export type GenerateResult = {
  version: number;
  unsupported: number;
  sentences: number;
};

export async function generateRecord(
  projectId: string,
  studentId: string,
): Promise<GenerateResult> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  await assertStudentInProject(supabase, projectId, studentId);
  const routing = await getRouting(supabase, projectId);

  // INV-2: 컨텍스트는 서버가 student_id 필터로만 조립한다.
  const source = createSupabaseContextSource(supabase, userId);
  const ctx = await buildStudentContext(studentId, source);
  if (ctx.submissions.length === 0 && !ctx.teacherMemo?.trim()) {
    throw new Error("반영된 제출물과 교사 메모가 없어 생성할 근거가 없습니다.");
  }

  // 생성 호출
  const gen = await callLLM({
    userId,
    purpose: "생성",
    modelRouting: routing,
    messages: buildGenerationMessages(ctx),
  });
  const content = gen.text.trim();
  if (!content) throw new Error("생성 결과가 비어 있습니다.");

  // 검증 호출 (실패해도 초안은 저장 — 검증 결과만 비워둔다)
  const validIds = ctx.submissions.map((s) => s.id);
  let verification: VerificationSentence[] = [];
  try {
    const ver = await callLLM({
      userId,
      purpose: "검증",
      modelRouting: routing,
      temperature: 0,
      messages: buildVerificationMessages(content, ctx),
    });
    verification = parseVerification(ver.text, validIds);
  } catch {
    verification = [];
  }

  // 저장: generated 행은 service role만(INV-3). 이전 현재 버전을 내리고 새 버전 insert.
  const admin = createAdminClient();
  const version = await nextVersionFor(admin, studentId);
  await admin
    .from("records")
    .update({ is_current: false })
    .eq("student_id", studentId)
    .eq("is_current", true);
  const { error } = await admin.from("records").insert({
    project_id: projectId,
    student_id: studentId,
    version,
    content,
    sources: validIds, // INV-3: 근거로 사용한 제출물 id 배열
    teacher_memo_used: !!ctx.teacherMemo?.trim(),
    verification,
    model: gen.model,
    origin: "generated",
    is_current: true,
  });
  if (error) throw new Error(`생기부 저장 실패: ${error.message}`);

  const unsupported = countUnsupported(verification);
  await writeAuditLog({
    actorId: userId,
    action: "record.generate",
    entity: "records",
    entityId: studentId,
    detail: {
      project_id: projectId,
      version,
      sources: validIds.length,
      unsupported,
    },
  });

  revalidatePath(`/projects/${projectId}/records`);
  return { version, unsupported, sentences: verification.length };
}

// ── 교사 편집 저장 (삭제·직접 수정 → 새 'edited' 버전, 재검증 보류) ──────
export async function saveRecordEdit(
  projectId: string,
  studentId: string,
  newContent: string,
  newVerification: VerificationSentence[],
): Promise<{ version: number }> {
  const { supabase } = await requireProjectOwner(projectId);
  await assertStudentInProject(supabase, projectId, studentId);

  const content = newContent.trim();
  if (!content) throw new Error("생기부 내용이 비어 있습니다.");

  // 현재 버전의 sources를 승계한다(근거 제출물 목록 유지).
  const { data: current } = await supabase
    .from("records")
    .select("sources")
    .eq("student_id", studentId)
    .eq("is_current", true)
    .maybeSingle();
  const sources = (current?.sources ?? []) as string[];

  // 소유자 세션(RLS: records_insert_teacher origin='edited')으로 새 버전.
  const version = await nextVersionFor(supabase, studentId);
  await supabase
    .from("records")
    .update({ is_current: false })
    .eq("student_id", studentId)
    .eq("is_current", true);
  const { error } = await supabase.from("records").insert({
    project_id: projectId,
    student_id: studentId,
    version,
    content,
    sources,
    teacher_memo_used: false,
    verification: newVerification,
    model: null,
    origin: "edited",
    is_current: true,
  });
  if (error) throw new Error(`편집 저장 실패: ${error.message}`);

  revalidatePath(`/projects/${projectId}/records`);
  return { version };
}

// ── 단일 문장 재생성 (재생성만 검증 재실행 — 쓰기 없음, 클라이언트가 반영) ──
export type RegenSentence = {
  text: string;
  grounded: boolean;
  source_submission_ids: string[];
  grounded_by_memo?: boolean;
};

export async function regenerateSentence(
  projectId: string,
  studentId: string,
  sentence: string,
): Promise<RegenSentence> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  await assertStudentInProject(supabase, projectId, studentId);
  const routing = await getRouting(supabase, projectId);

  const source = createSupabaseContextSource(supabase, userId);
  const ctx = await buildStudentContext(studentId, source);

  const gen = await callLLM({
    userId,
    purpose: "생성",
    modelRouting: routing,
    messages: buildSentenceRegenMessages(ctx, sentence),
  });
  const text = gen.text.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (!text) throw new Error("문장 재생성 결과가 비어 있습니다.");

  const validIds = ctx.submissions.map((s) => s.id);
  let verdict: VerificationSentence = {
    sentence: text,
    grounded: false,
    source_submission_ids: [],
  };
  try {
    const ver = await callLLM({
      userId,
      purpose: "검증",
      modelRouting: routing,
      temperature: 0,
      messages: buildVerificationMessages(text, ctx),
    });
    verdict = parseVerification(ver.text, validIds)[0] ?? verdict;
  } catch {
    // 검증 실패 시 보수적으로 unsupported 유지
  }

  return {
    text,
    grounded: verdict.grounded,
    source_submission_ids: verdict.source_submission_ids,
    ...(verdict.grounded_by_memo ? { grounded_by_memo: true } : {}),
  };
}

// ── 버전 이력 조회 ─────────────────────────────────────────────────────
export type RecordVersion = {
  version: number;
  origin: RecordOrigin;
  model: string | null;
  created_at: string;
  content: string;
  is_current: boolean;
};

export async function listRecordVersions(
  projectId: string,
  studentId: string,
): Promise<RecordVersion[]> {
  const { supabase } = await requireProjectOwner(projectId);
  await assertStudentInProject(supabase, projectId, studentId);
  const { data } = await supabase
    .from("records")
    .select("version, origin, model, created_at, content, is_current")
    .eq("student_id", studentId)
    .order("version", { ascending: false });
  return (data ?? []) as RecordVersion[];
}

// ── 프롬프트 프로필 ────────────────────────────────────────────────────
function sanitizeItems(items: ProfileItem[]): ProfileItem[] {
  return items
    .map((it) => ({
      id: typeof it.id === "string" && it.id ? it.id : crypto.randomUUID(),
      text: typeof it.text === "string" ? it.text.trim() : "",
    }))
    .filter((it) => it.text.length > 0);
}

async function loadLayerItems(
  supabase: Client,
  ownerId: string,
  target: ProfileTarget,
  projectId: string,
): Promise<{ guidelines: ProfileItem[]; prohibitions: ProfileItem[] }> {
  const base = supabase
    .from("prompt_profiles")
    .select("guidelines, prohibitions")
    .eq("owner_id", ownerId);
  const { data } =
    target === "account"
      ? await base.is("project_id", null).maybeSingle()
      : await base.eq("project_id", projectId).maybeSingle();
  return {
    guidelines: (data?.guidelines ?? []) as ProfileItem[],
    prohibitions: (data?.prohibitions ?? []) as ProfileItem[],
  };
}

async function upsertLayer(
  supabase: Client,
  ownerId: string,
  target: ProfileTarget,
  projectId: string,
  guidelines: ProfileItem[],
  prohibitions: ProfileItem[],
): Promise<void> {
  const pid = target === "account" ? null : projectId;
  const finder = supabase
    .from("prompt_profiles")
    .select("id")
    .eq("owner_id", ownerId);
  const { data: existing } =
    pid === null
      ? await finder.is("project_id", null).maybeSingle()
      : await finder.eq("project_id", pid).maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("prompt_profiles")
      .update({ guidelines, prohibitions })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("prompt_profiles")
      .insert({ owner_id: ownerId, project_id: pid, guidelines, prohibitions });
    if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
  }
}

// 계정 최초 접근 시 계정 기본 프로필을 시드한다(없을 때만 — 자동 반영 아님, 문체 기본값 로드).
export async function ensureDefaultProfile(): Promise<void> {
  const { userId } = await requireApproved();
  const supabase = await createClient();
  const { data } = await supabase
    .from("prompt_profiles")
    .select("id")
    .eq("owner_id", userId)
    .is("project_id", null)
    .maybeSingle();
  if (data) return;
  const { error } = await supabase.from("prompt_profiles").insert({
    owner_id: userId,
    project_id: null,
    guidelines: SEED_GUIDELINES,
    prohibitions: SEED_PROHIBITIONS,
  });
  // 동시 요청으로 이미 생성됐다면 무시(partial unique).
  if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
}

export async function saveProfileItems(
  projectId: string,
  target: ProfileTarget,
  guidelines: ProfileItem[],
  prohibitions: ProfileItem[],
): Promise<void> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  await upsertLayer(
    supabase,
    userId,
    target,
    projectId,
    sanitizeItems(guidelines),
    sanitizeItems(prohibitions),
  );
  revalidatePath(`/projects/${projectId}/profile`);
}

// 예시 인제스트: 분석만 한다(쓰기 없음). 제안은 UI 상태로만 표시된다(자동 반영 금지 — 수용 5).
export async function analyzeExample(
  projectId: string,
  target: ProfileTarget,
  exampleText: string,
): Promise<ProfileSuggestion[]> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const clean = exampleText.trim();
  if (!clean) throw new Error("예시 텍스트를 입력하세요.");
  const routing = await getRouting(supabase, projectId);
  const current = await loadLayerItems(supabase, userId, target, projectId);

  const res = await callLLM({
    userId,
    purpose: "생성", // 팩: purpose='생성' 모델로 분석
    modelRouting: routing,
    messages: buildExampleAnalysisMessages(clean, current),
  });
  return parseSuggestions(res.text, current);
}

// 승인한 제안만 반영한다(교사 승인 없이는 프로필이 바뀌지 않는다 — 수용 5).
export async function applyProfileSuggestions(
  projectId: string,
  target: ProfileTarget,
  approved: ProfileSuggestion[],
): Promise<void> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  if (approved.length === 0) return;

  const current = await loadLayerItems(supabase, userId, target, projectId);
  const guidelines = [...current.guidelines];
  const prohibitions = [...current.prohibitions];

  for (const s of approved) {
    const text = s.text.trim();
    if (!text) continue;
    const list = s.kind === "guideline" ? guidelines : prohibitions;
    if (s.action === "modify" && s.targetId) {
      const idx = list.findIndex((it) => it.id === s.targetId);
      if (idx >= 0) list[idx] = { ...list[idx], text };
      else list.push({ id: crypto.randomUUID(), text });
    } else {
      list.push({ id: crypto.randomUUID(), text });
    }
  }

  await upsertLayer(
    supabase,
    userId,
    target,
    projectId,
    guidelines,
    prohibitions,
  );
  revalidatePath(`/projects/${projectId}/profile`);
}
