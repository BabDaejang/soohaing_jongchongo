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

// ── 합성·순위·등급 재계산 후 student_scores 저장 (INV-6: service role 배치만 write) ──
async function recomputeAndSave(
  projectId: string,
  supabase: Client,
  admin: Admin,
): Promise<number> {
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
  type Row = { studentId: string; composite: number; effective: number };
  const rows: Row[] = [];
  for (const st of students ?? []) {
    const subScores = perStudent.get(st.id) ?? [];
    const override = st.score_override;
    if (subScores.length === 0 && override === null) continue;
    const composite = aggregateComposite(subScores, aggregation);
    const effective = override ?? composite;
    rows.push({ studentId: st.id, composite, effective });
  }

  const standings = computeStandings(
    rows.map((r) => r.effective),
    scheme,
    tieBreak,
  );

  const nowIso = new Date().toISOString();
  const inserts = rows.map((r, i) => ({
    project_id: projectId,
    student_id: r.studentId,
    composite_score: r.composite,
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
  return rows.length;
}

// ── 평가 실행(교사 버튼) — 증분 채점 후 재계산 ─────────────────────────
export type EvalSummary = {
  scored: number; // 새로 채점
  skipped: number; // 내용 불변 → 기존 평가 보존(증분)
  failed: number; // 호출·삽입 실패
  ranked: number; // 순위 산출된 학생 수
};

export async function runEvaluation(projectId: string): Promise<EvalSummary> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const { data: project } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const routing: ModelRouting = project.model_routing;

  const { data: rubric } = await supabase
    .from("rubrics")
    .select("criteria")
    .eq("project_id", projectId)
    .maybeSingle();
  const criteria = (rubric?.criteria ?? []) as RubricCriterion[];
  if (criteria.length === 0) {
    throw new Error("루브릭 기준이 없습니다. 먼저 루브릭을 설정하세요.");
  }

  const { data: targets } = await supabase
    .from("submissions")
    .select("id, content_text, content_hash")
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);

  // 증분 판정: 현재 평가의 content_hash 스냅샷.
  const targetIds = (targets ?? []).map((t) => t.id);
  const currentBySub = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data: existing } = await admin
      .from("evaluations")
      .select("submission_id, content_hash")
      .in("submission_id", targetIds)
      .eq("is_current", true);
    for (const e of existing ?? []) currentBySub.set(e.submission_id, e.content_hash);
  }

  const summary: EvalSummary = { scored: 0, skipped: 0, failed: 0, ranked: 0 };

  for (const sub of targets ?? []) {
    const existingHash = currentBySub.get(sub.id);
    if (existingHash !== undefined && existingHash === sub.content_hash) {
      summary.skipped += 1; // 증분: 내용 불변 → 재채점 안 함(기존 평가 보존)
      continue;
    }
    try {
      const res = await callLLM({
        userId,
        purpose: "평가",
        modelRouting: routing,
        temperature: 0, // 결정성(수용 2)
        messages: [
          {
            role: "user",
            content: buildEvalPrompt(criteria, sub.content_text.slice(0, 12000)),
          },
        ],
      });
      const { scores, total } = parseEvalScores(res.text, criteria);

      // partial unique(submission_id where is_current) 충돌 방지: 이전 현재 평가를 먼저 내린다.
      if (existingHash !== undefined) {
        await admin
          .from("evaluations")
          .update({ is_current: false })
          .eq("submission_id", sub.id)
          .eq("is_current", true);
      }
      const { error: insErr } = await admin.from("evaluations").insert({
        submission_id: sub.id,
        project_id: projectId,
        scores,
        total_score: total,
        content_hash: sub.content_hash,
        raw_llm_output: res.text,
        model: res.model,
        is_current: true,
      });
      if (insErr) {
        summary.failed += 1;
        continue;
      }
      summary.scored += 1;
    } catch {
      summary.failed += 1;
    }
  }

  summary.ranked = await recomputeAndSave(projectId, supabase, admin);

  await writeAuditLog({
    actorId: userId,
    action: "evaluation.run",
    entity: "projects",
    entityId: projectId,
    detail: {
      scored: summary.scored,
      skipped: summary.skipped,
      failed: summary.failed,
    },
  });

  revalidatePath(`/projects/${projectId}/evaluate`);
  return summary;
}

// ── 재계산만(재채점 없이 합성·순위·등급) ────────────────────────────────
export async function recalculate(projectId: string): Promise<number> {
  const { supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();
  const ranked = await recomputeAndSave(projectId, supabase, admin);
  revalidatePath(`/projects/${projectId}/evaluate`);
  return ranked;
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
  if (!Number.isFinite(value)) throw new Error("보정 점수가 올바르지 않습니다.");

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

  const routing = {} as ModelRouting;
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
