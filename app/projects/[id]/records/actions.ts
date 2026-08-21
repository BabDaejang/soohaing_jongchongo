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
  type StudentContext,
} from "@/lib/records/context";
import {
  buildGenerationMessages,
  buildSentenceRegenMessages,
} from "@/lib/prompts/generation";
import { buildVerificationMessages } from "@/lib/prompts/verification";
import { buildExampleAnalysisMessages } from "@/lib/prompts/example-ingest";
import {
  buildBriefDraftMessages,
  buildBriefRefineMessages,
  stripCodeFence,
  type BriefDraftInput,
} from "@/lib/prompts/brief";
import { parseVerification, countUnsupported } from "@/lib/records/verification";
import { parseSuggestions, type ProfileSuggestion } from "@/lib/records/suggestions";
import { parseProfileMarkdown } from "@/lib/records/profile-markdown";
import { extractTextFromExampleFile } from "@/lib/records/example-file";
import { SEED_GUIDELINES, SEED_PROHIBITIONS } from "@/lib/prompts/seed-profile";
import type {
  Database,
  ProfileItem,
  ProfileVersionSource,
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

// ── 일괄 생성 대상 조립 (대시보드 페이즈 3 터미널이 학생별 generateRecord를 순차 호출) ──
// INV-1: 서버는 대상 목록만 돌려주고, 학생 1명=호출 1회는 클라이언트 루프가 보장한다.
// 대상 = 반영(include_in_record)·매칭 확정 제출물이 1건 이상이거나 교사 메모가 있는 학생.
export type RecordRunTarget = { id: string; label: string }; // label = "학번 이름"

export async function prepareRecordRun(
  projectId: string,
): Promise<{ targets: RecordRunTarget[] }> {
  const { supabase } = await requireProjectOwner(projectId);

  const [studentsRes, subsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name, teacher_memo")
      .eq("project_id", projectId)
      .order("student_number", { nullsFirst: false })
      .order("name"),
    supabase
      .from("submissions")
      .select("student_id")
      .eq("project_id", projectId)
      .eq("include_in_record", true)
      .not("student_id", "is", null)
      .in("match_status", ["auto_matched", "confirmed"]),
  ]);

  const reflectCount = new Map<string, number>();
  for (const s of subsRes.data ?? []) {
    if (!s.student_id) continue;
    reflectCount.set(s.student_id, (reflectCount.get(s.student_id) ?? 0) + 1);
  }

  const targets: RecordRunTarget[] = [];
  for (const st of studentsRes.data ?? []) {
    const hasReflect = (reflectCount.get(st.id) ?? 0) > 0;
    const hasMemo = !!st.teacher_memo?.trim();
    if (!hasReflect && !hasMemo) continue;
    targets.push({
      id: st.id,
      label: `${st.student_number ?? "?"} ${st.name}`.trim(),
    });
  }

  return { targets };
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
): Promise<{ guidelines: ProfileItem[]; prohibitions: ProfileItem[]; briefMd: string }> {
  const base = supabase
    .from("prompt_profiles")
    .select("guidelines, prohibitions, brief_md")
    .eq("owner_id", ownerId);
  const { data } =
    target === "account"
      ? await base.is("project_id", null).maybeSingle()
      : await base.eq("project_id", projectId).maybeSingle();
  return {
    guidelines: (data?.guidelines ?? []) as ProfileItem[],
    prohibitions: (data?.prohibitions ?? []) as ProfileItem[],
    briefMd: data?.brief_md ?? "",
  };
}

// 프로필 저장 + 버전 증가 + 이력 스냅샷(세션 8a 확장). source로 이력 출처를 기록한다.
async function saveProfileLayer(
  supabase: Client,
  ownerId: string,
  target: ProfileTarget,
  projectId: string,
  guidelines: ProfileItem[],
  prohibitions: ProfileItem[],
  briefMd: string, // 브리프도 같은 버전 기계를 탄다(배치 5, P-7 — 새 편집 체계 금지)
  source: ProfileVersionSource,
): Promise<{ profileId: string; version: number }> {
  const pid = target === "account" ? null : projectId;
  const finder = supabase
    .from("prompt_profiles")
    .select("id, version")
    .eq("owner_id", ownerId);
  const { data: existing } =
    pid === null
      ? await finder.is("project_id", null).maybeSingle()
      : await finder.eq("project_id", pid).maybeSingle();

  let profileId: string;
  let version: number;
  if (existing) {
    version = existing.version + 1;
    const { error } = await supabase
      .from("prompt_profiles")
      .update({ guidelines, prohibitions, brief_md: briefMd, version })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    profileId = existing.id;
  } else {
    version = 1;
    const { data: inserted, error } = await supabase
      .from("prompt_profiles")
      .insert({
        owner_id: ownerId,
        project_id: pid,
        guidelines,
        prohibitions,
        brief_md: briefMd,
        version,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    profileId = inserted.id;
  }

  // 이력 스냅샷(append-only). 실패해도 현재 상태는 일관되므로 로깅만 한다.
  const { error: histErr } = await supabase
    .from("prompt_profile_versions")
    .insert({
      profile_id: profileId,
      owner_id: ownerId,
      project_id: pid,
      version,
      guidelines,
      prohibitions,
      brief_md: briefMd,
      source,
    });
  if (histErr) {
    console.error("prompt_profile_versions 기록 실패:", histErr.message);
  }
  return { profileId, version };
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
  const { data: inserted, error } = await supabase
    .from("prompt_profiles")
    .insert({
      owner_id: userId,
      project_id: null,
      guidelines: SEED_GUIDELINES,
      prohibitions: SEED_PROHIBITIONS,
      version: 1,
    })
    .select("id")
    .single();
  if (error) {
    // 동시 요청으로 이미 생성됐다면 무시(partial unique).
    if (error.code === UNIQUE_VIOLATION) return;
    throw new Error(error.message);
  }
  await supabase.from("prompt_profile_versions").insert({
    profile_id: inserted.id,
    owner_id: userId,
    project_id: null,
    version: 1,
    guidelines: SEED_GUIDELINES,
    prohibitions: SEED_PROHIBITIONS,
    source: "seed",
  });
}

export async function saveProfileItems(
  projectId: string,
  target: ProfileTarget,
  guidelines: ProfileItem[],
  prohibitions: ProfileItem[],
  briefMd: string, // 배치 5 — 항목과 브리프를 한 버전으로 저장(부분 저장 없음)
): Promise<void> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  await saveProfileLayer(
    supabase,
    userId,
    target,
    projectId,
    sanitizeItems(guidelines),
    sanitizeItems(prohibitions),
    briefMd.trim(),
    "edit",
  );
  revalidatePath(`/projects/${projectId}/profile`);
}

// 예시 파일 → 분석용 텍스트 추출 (세션 8a 확장, 사용자 지시). 추출만 하고 쓰지 않는다 —
// 추출 텍스트는 입력창에 채워져 교사가 확인한 뒤 분석(analyzeExample)으로 이어진다.
export async function extractExampleText(
  projectId: string,
  formData: FormData,
): Promise<{ text: string; filename: string }> {
  await requireProjectOwner(projectId);
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("파일이 없습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await extractTextFromExampleFile(file.name, bytes);
  return { text, filename: file.name };
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

  await saveProfileLayer(
    supabase,
    userId,
    target,
    projectId,
    guidelines,
    prohibitions,
    current.briefMd, // 예시 반영은 목록만 바꾼다 — 브리프는 현재 값 보존
    "ingest",
  );
  revalidatePath(`/projects/${projectId}/profile`);
}

// ── 프로필 MD 가져오기·버전 이력·복원 (세션 8a 확장) ────────────────────
// 편집한 Markdown을 파싱해 반영한다(서버에서 재파싱 — 신뢰 경계). source='import'.
export async function importProfileFromMarkdown(
  projectId: string,
  target: ProfileTarget,
  markdown: string,
): Promise<{ version: number; guidelines: number; prohibitions: number }> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const parsed = parseProfileMarkdown(markdown);
  const guidelines = sanitizeItems(parsed.guidelines);
  const prohibitions = sanitizeItems(parsed.prohibitions);
  const briefMd = parsed.brief.trim();
  if (guidelines.length === 0 && prohibitions.length === 0 && briefMd === "") {
    throw new Error("가져올 항목을 찾지 못했습니다. 형식을 확인하세요.");
  }
  const { version } = await saveProfileLayer(
    supabase,
    userId,
    target,
    projectId,
    guidelines,
    prohibitions,
    briefMd,
    "import",
  );
  revalidatePath(`/projects/${projectId}/profile`);
  return { version, guidelines: guidelines.length, prohibitions: prohibitions.length };
}

export type ProfileVersionRow = {
  version: number;
  source: ProfileVersionSource;
  created_at: string;
  guidelines: ProfileItem[];
  prohibitions: ProfileItem[];
  brief_md: string; // 배치 5 — 이력·복원이 브리프를 포함해 왕복
};

async function findProfileId(
  supabase: Client,
  ownerId: string,
  target: ProfileTarget,
  projectId: string,
): Promise<string | null> {
  const pid = target === "account" ? null : projectId;
  const finder = supabase
    .from("prompt_profiles")
    .select("id")
    .eq("owner_id", ownerId);
  const { data } =
    pid === null
      ? await finder.is("project_id", null).maybeSingle()
      : await finder.eq("project_id", pid).maybeSingle();
  return data?.id ?? null;
}

export async function listProfileVersions(
  projectId: string,
  target: ProfileTarget,
): Promise<ProfileVersionRow[]> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const profileId = await findProfileId(supabase, userId, target, projectId);
  if (!profileId) return [];
  const { data } = await supabase
    .from("prompt_profile_versions")
    .select("version, source, created_at, guidelines, prohibitions, brief_md")
    .eq("profile_id", profileId)
    .order("version", { ascending: false });
  return (data ?? []) as ProfileVersionRow[];
}

// 과거 버전으로 복원 = 그 스냅샷의 항목을 새 버전으로 저장(이력 삭제 없음). source='restore'.
export async function restoreProfileVersion(
  projectId: string,
  target: ProfileTarget,
  version: number,
): Promise<{ version: number }> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const profileId = await findProfileId(supabase, userId, target, projectId);
  if (!profileId) throw new Error("프로필을 찾을 수 없습니다.");
  const { data: snap } = await supabase
    .from("prompt_profile_versions")
    .select("guidelines, prohibitions, brief_md")
    .eq("profile_id", profileId)
    .eq("version", version)
    .maybeSingle();
  if (!snap) throw new Error("해당 버전을 찾을 수 없습니다.");
  const res = await saveProfileLayer(
    supabase,
    userId,
    target,
    projectId,
    snap.guidelines as ProfileItem[],
    snap.prohibitions as ProfileItem[],
    snap.brief_md ?? "",
    "restore",
  );
  revalidatePath(`/projects/${projectId}/profile`);
  return { version: res.version };
}
// ── 최종 프롬프트 미리보기 (리팩토링 4 배치 5, P-7) ─────────────────────
// "지금 무엇이 적용되는가"를 답한다: 실제 병합된 브리프·참고·금지·분량 설정으로
// buildGenerationMessages를 조립해 돌려준다. **조회만** — DB 쓰기·LLM 호출 없음.
// 학생 데이터 자리는 플레이스홀더 문구다(가짜 이름 없음 — INV-2의 서버 조립 원칙 그대로,
// 클라이언트 텍스트 주입 경로도 없다).
export async function previewGenerationPrompt(
  projectId: string,
): Promise<{ system: string; user: string }> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const source = createSupabaseContextSource(supabase, userId);
  const profile = await source.getMergedProfile(projectId);
  const settings = await source.getRecordSettings(projectId);

  const ctx: StudentContext = {
    studentId: "(미리보기)",
    studentName: "(미리보기)", // 프롬프트에 이름은 들어가지 않는다(기존 설계)
    projectId,
    submissions: [
      {
        id: "(제출물-id)",
        content_text:
          "[학생 제출물 1 — 실제 생성 시 이 자리에 해당 학생의 반영 제출물 원문이 들어갑니다]",
        source_type: "manual",
      },
    ],
    teacherMemo: "[교사 관찰 메모 — 실제 생성 시 해당 학생의 메모가 들어갑니다]",
    guidelines: profile.guidelines,
    prohibitions: profile.prohibitions,
    brief: profile.brief,
    charLimit: settings?.charLimit ?? 500,
    countMethod: settings?.countMethod ?? "chars",
  };

  const [system, user] = buildGenerationMessages(ctx);
  return { system: String(system.content), user: String(user.content) };
}
// ── 브리프 AI 협업 작성 (리팩토링 4 배치 6, P-8) ─────────────────────────
// **둘 다 DB 쓰기가 없다.** 반환한 MD는 편집기(BriefPanel)를 채울 뿐이고, 저장은 언제나
// 교사의 명시적 [저장](saveProfileItems → 새 버전)이다 — 예시 인제스트(analyzeExample)와
// 같은 무자동반영 원칙. AI가 스스로 프로필을 바꾸는 경로는 존재하지 않는다.

// 첨부 파일(평가계획서·활동 안내문) 텍스트 추출. 클라이언트가 아니라 서버에서 뽑는다
// (기존 extractExampleText와 같은 관행 — 지원 형식·에러 문구 재사용).
export async function extractBriefSourceText(
  projectId: string,
  formData: FormData,
): Promise<{ text: string; filename: string }> {
  await requireProjectOwner(projectId);
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("파일이 없습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await extractTextFromExampleFile(file.name, bytes);
  return { text, filename: file.name };
}

export type BriefDraftFormInput = {
  activityName: string;
  description: string;
  emphasis: string;
  freeText: string;
  attachedText: string;
};

// 폼 입력 → 브리프 MD 초안. 저장하지 않는다.
export async function draftBrief(
  projectId: string,
  input: BriefDraftFormInput,
): Promise<{ md: string }> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const clean: BriefDraftInput = {
    activityName: (input.activityName ?? "").trim(),
    description: (input.description ?? "").trim(),
    emphasis: (input.emphasis ?? "").trim(),
    freeText: (input.freeText ?? "").trim(),
    attachedText: (input.attachedText ?? "").trim(),
  };
  // 재료가 하나도 없으면 모델이 활동을 통째로 지어낸다 — 호출 전에 막는다.
  if (
    !clean.activityName &&
    !clean.description &&
    !clean.emphasis &&
    !clean.freeText &&
    !clean.attachedText
  ) {
    throw new Error("활동명·설명·강조 포인트 중 하나 이상을 입력하세요.");
  }

  const routing = await getRouting(supabase, projectId);
  const res = await callLLM({
    userId,
    purpose: "생성",
    modelRouting: routing,
    messages: buildBriefDraftMessages(clean),
  });
  const md = stripCodeFence(res.text);
  if (!md) throw new Error("초안이 비어 있습니다. 입력을 보강해 다시 시도하세요.");
  return { md };
}

// 현재 브리프 + 요청 → 수정된 전문. 저장하지 않는다.
export async function refineBrief(
  projectId: string,
  currentMd: string,
  request: string,
): Promise<{ md: string }> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const current = (currentMd ?? "").trim();
  const req = (request ?? "").trim();
  if (!current) throw new Error("다듬을 브리프가 비어 있습니다. 먼저 내용을 작성하세요.");
  if (!req) throw new Error("수정 요청을 입력하세요.");

  const routing = await getRouting(supabase, projectId);
  const res = await callLLM({
    userId,
    purpose: "생성",
    modelRouting: routing,
    messages: buildBriefRefineMessages(current, req),
  });
  const md = stripCodeFence(res.text);
  if (!md) throw new Error("다듬기 결과가 비어 있습니다.");
  return { md };
}
