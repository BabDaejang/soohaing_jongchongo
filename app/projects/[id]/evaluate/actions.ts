"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireProjectOwner } from "@/lib/projects";
import { createAdminClient } from "@/lib/supabase/admin";
import { callLLM } from "@/lib/llm";
import type { ModelRouting } from "@/lib/llm";
import { writeAuditLog } from "@/lib/audit";
import {
  aggregateComposite,
  submissionScore,
  type CriterionScore,
} from "@/lib/scoring";
import { computeStandings } from "@/lib/grading";
import { assignDisplayScores, initialConfirmCount } from "@/lib/scores/display";
import type {
  Database,
  EvaluationCriterionScore,
  GradingScheme,
  MatchStatus,
  RubricCriterion,
  ScoreAggregation,
  TieBreak,
} from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type Admin = ReturnType<typeof createAdminClient>;

// 채점 대상 조건(혼입 방지): 반영 체크 + 매칭 확정 + 학생 귀속 제출물만.
const MATCHED_STATUSES: MatchStatus[] = ["auto_matched", "confirmed"];
const ROUTING_KEYS = ["extract", "evaluate", "generate", "verify"] as const;
const GRADING_SCHEMES: GradingScheme[] = ["grade5", "grade9"];

// ── 채점 프롬프트·파싱 ────────────────────────────────────────────────
function buildEvalPrompt(criteria: RubricCriterion[], content: string): string {
  const rubricText = criteria
    .map((c) => `- id:${c.id} | ${c.name} (0~${c.max_score}점): ${c.description}`)
    .join("\n");
  return [
    "너는 학생 수행평가 채점자다. 아래 루브릭 기준에 따라 제출물을 각 기준의 0점부터 만점까지 정수로 채점하라.",
    "각 기준 점수마다 제출물 원문에서 판단의 근거가 된 부분을 그대로 인용하라(근거 없는 채점 금지).",
    "근거를 찾지 못하면 점수를 낮게 주고 인용은 빈 문자열로 둔다.",
    "반드시 아래 JSON 배열 형식으로만 답하라(설명·다른 텍스트 금지):",
    '[{"criterion_id":"<루브릭 id>","score":<정수>,"evidence_quote":"<원문 인용>"}]',
    "",
    "[루브릭 기준]",
    rubricText,
    "",
    "[제출물 원문]",
    content,
  ].join("\n");
}

function parseEvalScores(
  text: string,
  criteria: RubricCriterion[],
): { scores: EvaluationCriterionScore[]; total: number } {
  const byId = new Map<string, { score: number; evidence: string }>();
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item !== "object" || item === null) continue;
          const rec = item as Record<string, unknown>;
          const cid = typeof rec.criterion_id === "string" ? rec.criterion_id : null;
          if (!cid) continue;
          const rawScore =
            typeof rec.score === "number" ? rec.score : Number(rec.score);
          const evidence =
            typeof rec.evidence_quote === "string" ? rec.evidence_quote : "";
          byId.set(cid, {
            score: Number.isFinite(rawScore) ? rawScore : 0,
            evidence,
          });
        }
      }
    } catch {
      // 파싱 실패 → 전 기준 0점(아래 map에서 처리)
    }
  }
  // 루브릭 기준 순서로 정규화: 각 점수를 [0, max_score]로 클램프, 누락은 0점.
  const scores: EvaluationCriterionScore[] = criteria.map((c) => {
    const found = byId.get(c.id);
    const clamped = found ? Math.max(0, Math.min(c.max_score, found.score)) : 0;
    return { criterion_id: c.id, score: clamped, evidence_quote: found?.evidence ?? "" };
  });
  const total = scores.reduce((s, x) => s + x.score, 0);
  return { scores, total };
}

// ── 합성·표시 점수·순위·등급 재계산 후 student_scores 저장 (INV-6: service role 배치만 write) ──
// 999점 표시 점수(display_score)를 끼워 넣는다: 초기 확정 인원 미달이면 확정하지 않고(행 미생성),
// 충족하면 원점수 순위로 스프레드하되 이전 배정은 유지(sticky). effective = override ?? display.
export type RecomputeResult = {
  ranked: number; // 확정 시 student_scores에 기록된 학생 수(미확정이면 0)
  pendingConfirm: { scored: number; required: number } | null; // 미확정 국면 정보
};

async function recomputeAndSave(
  projectId: string,
  supabase: Client,
  admin: Admin,
): Promise<RecomputeResult> {
  const { data: project } = await supabase
    .from("projects")
    .select("score_aggregation, grading_scheme, tie_break")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const aggregation = project.score_aggregation as ScoreAggregation;
  const scheme = project.grading_scheme as GradingScheme;
  const tieBreak = project.tie_break as TieBreak;

  const { data: rubric } = await supabase
    .from("rubrics")
    .select("criteria")
    .eq("project_id", projectId)
    .maybeSingle();
  const criteria = (rubric?.criteria ?? []) as RubricCriterion[];

  const { data: students } = await supabase
    .from("students")
    .select("id, score_override")
    .eq("project_id", projectId);

  // 반영+매칭 제출물 → 학생 매핑
  const { data: subs } = await supabase
    .from("submissions")
    .select("id, student_id")
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);
  const subToStudent = new Map<string, string>();
  for (const s of subs ?? []) if (s.student_id) subToStudent.set(s.id, s.student_id);

  // 현재 평가만 집계
  const { data: evals } = await admin
    .from("evaluations")
    .select("submission_id, scores")
    .eq("project_id", projectId)
    .eq("is_current", true);

  const perStudent = new Map<string, number[]>();
  for (const e of evals ?? []) {
    const studentId = subToStudent.get(e.submission_id);
    if (!studentId) continue; // 제외/미매칭 제출물의 평가는 순위에서 무시
    const cScores = e.scores.map<CriterionScore>((s) => ({
      criterion_id: s.criterion_id,
      score: s.score,
    }));
    const subScore = submissionScore(cScores, criteria, aggregation);
    const arr = perStudent.get(studentId) ?? [];
    arr.push(subScore);
    perStudent.set(studentId, arr);
  }

  // 랭킹 대상: 평가가 있거나 override가 설정된 학생.
  type Row = {
    studentId: string;
    composite: number;
    override: number | null;
    hasEval: boolean;
  };
  const rows: Row[] = [];
  for (const st of students ?? []) {
    const subScores = perStudent.get(st.id) ?? [];
    const override = st.score_override;
    const hasEval = subScores.length > 0;
    if (!hasEval && override === null) continue;
    const composite = aggregateComposite(subScores, aggregation);
    rows.push({ studentId: st.id, composite, override, hasEval });
  }

  // 이전 표시 점수 배정(sticky) — 삭제 전에 조회. null 값(override만 있던 행)은 제외.
  const { data: prior } = await admin
    .from("student_scores")
    .select("student_id, display_score")
    .eq("project_id", projectId);
  const existing = new Map<string, number>();
  for (const p of prior ?? []) {
    if (p.display_score !== null) existing.set(p.student_id, p.display_score);
  }

  // 채점 대상 총수 = 제출물이 귀속된 학생 수(미채점 포함). override만 있는 학생은 제외.
  const totalTargets = new Set(subToStudent.values()).size;

  // 원점수(composite) 내림차순, 동률은 studentId 사전순(결정성).
  const rawRanked = rows
    .filter((r) => r.hasEval)
    .sort(
      (a, b) =>
        b.composite - a.composite || (a.studentId < b.studentId ? -1 : 1),
    )
    .map((r) => ({ studentId: r.studentId, raw: r.composite }));

  const { displays, confirmed } = assignDisplayScores({
    rawRanked,
    existing,
    totalTargets,
  });

  // 미확정 국면: 표시 점수를 확정하지 않는다 — 기존 스냅샷을 지우기만 하고 삽입하지 않는다.
  if (!confirmed) {
    await admin.from("student_scores").delete().eq("project_id", projectId);
    await admin.from("projects").update({ needs_recalc: false }).eq("id", projectId);
    return {
      ranked: 0,
      pendingConfirm: {
        scored: rawRanked.length,
        required: initialConfirmCount(totalTargets),
      },
    };
  }

  // 확정: effective = override ?? display. override만 있고 평가 없는 학생은 display=null.
  const withDisplay = rows.map((r) => {
    const display = displays.get(r.studentId) ?? null;
    const effective = r.override ?? display ?? 0; // 둘 다 null은 발생하지 않음(위 필터)
    return { ...r, display, effective };
  });

  const standings = computeStandings(
    withDisplay.map((r) => r.effective),
    scheme,
    tieBreak,
  );

  const nowIso = new Date().toISOString();
  const inserts = withDisplay.map((r, i) => ({
    project_id: projectId,
    student_id: r.studentId,
    composite_score: r.composite,
    display_score: r.display,
    effective_score: r.effective,
    rank: standings[i].rank,
    grade: standings[i].grade,
    calculated_at: nowIso,
  }));

  // 결정적 재작성: 기존 순위 스냅샷을 지우고 대상만 다시 삽입(탈락 학생 제거).
  await admin.from("student_scores").delete().eq("project_id", projectId);
  if (inserts.length > 0) {
    const { error } = await admin.from("student_scores").insert(inserts);
    if (error) throw new Error(`순위 저장 실패: ${error.message}`);
  }

  await admin.from("projects").update({ needs_recalc: false }).eq("id", projectId);
  return { ranked: withDisplay.length, pendingConfirm: null };
}

// ── 평가 실행 — 클라이언트 구동 1건 단위(prepare → evaluateOne × N → finalize) ──
// 전건을 한 서버 액션에서 돌리던 이전 구조는 진행 표시·중단이 불가하고 성공 시
// 타임아웃이 확정이라, 실행 터미널(useSequentialRun)이 건별로 호출하는 구조로 나눴다.
export type EvalTarget = { id: string; label: string }; // label = "학번 이름"(+ " · 파일명")

// 채점 대상 목록·라벨과 증분 보존 건수를 조립한다(LLM 호출 없음).
export async function prepareEvaluation(
  projectId: string,
): Promise<{ targets: EvalTarget[]; skipped: number }> {
  const { supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const { data: rubric } = await supabase
    .from("rubrics")
    .select("criteria")
    .eq("project_id", projectId)
    .maybeSingle();
  const criteria = (rubric?.criteria ?? []) as RubricCriterion[];
  if (criteria.length === 0) {
    throw new Error("루브릭 기준이 없습니다. 먼저 루브릭을 설정하세요.");
  }

  const { data: subs } = await supabase
    .from("submissions")
    .select("id, student_id, source_filename, content_hash")
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);
  const rows = subs ?? [];

  // label용 학생 정보(학번·이름)는 students 1회 조회로 조인.
  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const studentById = new Map((students ?? []).map((s) => [s.id, s]));

  // 증분: 현재 평가(is_current)의 content_hash와 같으면 재채점 대상에서 제외(보존).
  const ids = rows.map((r) => r.id);
  const currentBySub = new Map<string, string>();
  if (ids.length > 0) {
    const { data: existing } = await admin
      .from("evaluations")
      .select("submission_id, content_hash")
      .in("submission_id", ids)
      .eq("is_current", true);
    for (const e of existing ?? []) currentBySub.set(e.submission_id, e.content_hash);
  }

  const targets: EvalTarget[] = [];
  let skipped = 0;
  for (const r of rows) {
    const existingHash = currentBySub.get(r.id);
    if (existingHash !== undefined && existingHash === r.content_hash) {
      skipped += 1; // 증분: 내용 불변 → 재채점 안 함(기존 평가 보존)
      continue;
    }
    const st = r.student_id ? studentById.get(r.student_id) : undefined;
    const who = st ? `${st.student_number ?? "?"} ${st.name}`.trim() : "(미상)";
    const label = r.source_filename ? `${who} · ${r.source_filename}` : who;
    targets.push({ id: r.id, label });
  }

  return { targets, skipped };
}

// 제출물 1건 채점(터미널이 반복 호출). 에러는 버리지 않고 message로 돌려준다.
// 클라이언트 입력은 id뿐 — 루브릭·라우팅은 서버가 DB에서 재조립한다(INV-2).
export async function evaluateOne(
  projectId: string,
  submissionId: string,
): Promise<{ ok: boolean; message: string }> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const { data: rubric } = await supabase
    .from("rubrics")
    .select("criteria")
    .eq("project_id", projectId)
    .maybeSingle();
  const criteria = (rubric?.criteria ?? []) as RubricCriterion[];
  if (criteria.length === 0) {
    return { ok: false, message: "루브릭 기준이 없습니다." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  const routing: ModelRouting = project.model_routing;

  // 제출물 소속·자격 재확인(다른 프로젝트·미매칭·미반영 제출물 차단).
  const { data: sub } = await supabase
    .from("submissions")
    .select(
      "id, content_text, content_hash, include_in_eval, student_id, match_status",
    )
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (
    !sub ||
    !sub.include_in_eval ||
    !sub.student_id ||
    !MATCHED_STATUSES.includes(sub.match_status)
  ) {
    return { ok: false, message: "채점 대상이 아닌 제출물입니다." };
  }

  // 동시 탭 방어: 채점 직전 현재 평가 해시를 재확인 — 같으면 이미 채점됨(증분).
  const { data: current } = await admin
    .from("evaluations")
    .select("content_hash")
    .eq("submission_id", submissionId)
    .eq("is_current", true)
    .maybeSingle();
  if (current && current.content_hash === sub.content_hash) {
    return { ok: true, message: "이미 채점됨(증분)" };
  }

  // temperature 0으로 결정성 요청 — gpt-5 계열은 배치 1 어댑터가 temperature를 자동 생략한다.
  let text: string;
  let model: string;
  try {
    const res = await callLLM({
      userId,
      purpose: "평가",
      modelRouting: routing,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: buildEvalPrompt(criteria, sub.content_text.slice(0, 12000)),
        },
      ],
    });
    text = res.text;
    model = res.model;
  } catch (e) {
    // 더 이상 버리지 않는다 — 원인을 그대로 돌려 터미널·서킷 브레이커가 표시하게 한다.
    const msg = e instanceof Error ? e.message : "LLM 호출 실패";
    return { ok: false, message: msg.slice(0, 300) };
  }

  const { scores, total } = parseEvalScores(text, criteria);

  // partial unique(submission_id where is_current) 충돌 방지: 이전 현재 평가를 먼저 내린다.
  if (current) {
    await admin
      .from("evaluations")
      .update({ is_current: false })
      .eq("submission_id", submissionId)
      .eq("is_current", true);
  }
  const { error: insErr } = await admin.from("evaluations").insert({
    submission_id: submissionId,
    project_id: projectId,
    scores,
    total_score: total,
    content_hash: sub.content_hash,
    raw_llm_output: text,
    model,
    is_current: true,
  });
  if (insErr) {
    return { ok: false, message: `평가 저장 실패: ${insErr.message}`.slice(0, 300) };
  }

  return { ok: true, message: `원점수 ${total}점` };
}

// 실행 종료 후 1회: 합성·순위·등급 재계산 → 감사 로그 → revalidate.
// revalidatePath는 여기서만 — 건별로 하면 매 건 RSC 재조회가 낭비다.
export async function finalizeEvaluation(
  projectId: string,
  counts: { scored: number; failed: number; skipped: number },
  aborted: boolean,
  sampleFailure?: string, // 클라이언트가 수집한 대표 실패 사유
): Promise<RecomputeResult> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const result = await recomputeAndSave(projectId, supabase, admin);

  await writeAuditLog({
    actorId: userId,
    action: "evaluation.run",
    entity: "projects",
    entityId: projectId,
    detail: {
      scored: counts.scored,
      failed: counts.failed,
      skipped: counts.skipped,
      aborted,
      ...(sampleFailure ? { sample_failure: sampleFailure.slice(0, 300) } : {}),
    },
  });

  revalidatePath(`/projects/${projectId}/evaluate`);
  return result;
}

// ── 재계산만(재채점 없이 합성·표시 점수·순위·등급) ──────────────────────
export async function recalculate(projectId: string): Promise<RecomputeResult> {
  const { supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();
  const result = await recomputeAndSave(projectId, supabase, admin);
  revalidatePath(`/projects/${projectId}/evaluate`);
  return result;
}

// ── 교사 보정 override (사유 필수, 감사 로그, 재계산) ────────────────────
export async function setScoreOverride(
  projectId: string,
  studentId: string,
  value: number,
  reason: string,
) {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error("보정 사유를 입력하세요."); // 수용 4
  // 표시 점수 스케일과 일치: 0~999 정수(2026-07-12 점수 체계 전환).
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    throw new Error("보정 점수는 0~999 정수입니다.");
  }

  const { error } = await supabase
    .from("students")
    .update({ score_override: value, override_reason: cleanReason })
    .eq("id", studentId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId: userId,
    action: "score_override.set",
    entity: "students",
    entityId: studentId,
    detail: { project_id: projectId, value, reason: cleanReason },
  });

  const admin = createAdminClient();
  await recomputeAndSave(projectId, supabase, admin);
  revalidatePath(`/projects/${projectId}/evaluate`);
}

export async function clearScoreOverride(projectId: string, studentId: string) {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const { error } = await supabase
    .from("students")
    .update({ score_override: null, override_reason: null })
    .eq("id", studentId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId: userId,
    action: "score_override.clear",
    entity: "students",
    entityId: studentId,
    detail: { project_id: projectId },
  });

  const admin = createAdminClient();
  await recomputeAndSave(projectId, supabase, admin);
  revalidatePath(`/projects/${projectId}/evaluate`);
}

// ── 등급제 토글 저장(파생 표시라 재계산 불필요) ─────────────────────────
export async function updateGradingScheme(
  projectId: string,
  scheme: GradingScheme,
) {
  const { supabase } = await requireProjectOwner(projectId);
  if (!GRADING_SCHEMES.includes(scheme)) {
    throw new Error("등급제 값이 올바르지 않습니다.");
  }
  const { error } = await supabase
    .from("projects")
    .update({ grading_scheme: scheme })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/evaluate`);
  revalidatePath(`/projects/${projectId}/settings`);
}

// ── 용도별 model_routing 편집(세션 4 이월) ─────────────────────────────
export async function updateModelRouting(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { supabase } = await requireProjectOwner(projectId);

  const { data: providers } = await supabase.from("providers").select("id");
  const validIds = new Set((providers ?? []).map((p) => p.id));

  // 4키만 재조립하면 배치 5의 default·배치 7의 rubric 키가 저장 때마다 소실된다 → 기존 라우팅을 보존.
  const { data: current } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  const routing: ModelRouting = { ...(current?.model_routing as ModelRouting) };
  for (const key of ROUTING_KEYS) {
    const providerId = String(formData.get(`${key}_provider`) ?? "").trim();
    const model = String(formData.get(`${key}_model`) ?? "").trim();
    if (!validIds.has(providerId)) {
      throw new Error(`'${key}' 프로바이더 선택이 올바르지 않습니다.`);
    }
    if (!model) throw new Error(`'${key}' 모델을 입력하세요.`);
    routing[key] = { provider_id: providerId, model };
  }

  const { error } = await supabase
    .from("projects")
    .update({ model_routing: routing })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/settings`);
}
