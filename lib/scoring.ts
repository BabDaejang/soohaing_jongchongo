// 합성 점수 계산 (SPEC 6절). **순수 함수** — 동일 입력 → 동일 출력(결정성, 수용 2).
// 점수는 학생의 대략적 수준 지표이며, 목적은 학생 간 **상대 순위**다 (DECISIONS 2026-07-09).
import type { ScoreAggregation, RubricCriterion } from "@/lib/supabase/types";

export type CriterionScore = { criterion_id: string; score: number };

// 한 제출물의 점수.
//   weighted        → Σ(기준 점수 × 기준 weight)   (DATA_MODEL 6절: weight는 weighted일 때 사용)
//   sum / avg       → Σ 기준 점수 (= evaluations.total_score와 동일한 단순합)
export function submissionScore(
  scores: CriterionScore[],
  criteria: RubricCriterion[],
  aggregation: ScoreAggregation,
): number {
  if (aggregation !== "weighted") {
    return scores.reduce((s, c) => s + c.score, 0);
  }
  const weightOf = new Map(criteria.map((c) => [c.id, c.weight]));
  return scores.reduce(
    (s, c) => s + c.score * (weightOf.get(c.criterion_id) ?? 1),
    0,
  );
}

// 학생의 제출물 점수들을 합성한다.
//   sum       → 제출물 점수 합
//   avg       → 제출물 점수 평균
//   weighted  → 가중 제출물 점수의 평균 (DECISIONS 2026-07-09)
// 제출물이 없으면 0 (미채점 학생은 배치에서 student_scores를 만들지 않는다).
export function aggregateComposite(
  submissionScores: number[],
  aggregation: ScoreAggregation,
): number {
  if (submissionScores.length === 0) return 0;
  const sum = submissionScores.reduce((s, v) => s + v, 0);
  if (aggregation === "sum") return sum;
  return sum / submissionScores.length; // avg · weighted 모두 평균
}

// ── 교사 수정 점수 검증 (리팩토링 4 배치 4, P-3) ─────────────────────────
//
// 교사 입력은 **클램프하지 않고 거부한다.** AI 파싱(parseEvalScores)은 상대가 모델이라
// 관대하게 보정하는 게 맞지만, 교사가 넣은 값을 말없이 바꾸면 화면에 저장한 값과 다른 값이
// 남아 신뢰가 깨진다 — 무엇이 잘못됐는지 알려주고 되돌려보내는 편이 낫다.
export type TeacherScoreInput = { criterion_id: string; score: number };

export type TeacherScoreValidation =
  | { ok: true; scores: CriterionScore[] } // 루브릭 순서로 정규화됨
  | { ok: false; error: string };

export function validateTeacherScores(
  input: TeacherScoreInput[],
  criteria: RubricCriterion[],
): TeacherScoreValidation {
  if (criteria.length === 0) {
    return { ok: false, error: "루브릭 기준이 없습니다." };
  }

  const byId = new Map<string, number>();
  for (const item of input) {
    const cid = item?.criterion_id;
    if (typeof cid !== "string" || cid === "") {
      return { ok: false, error: "기준 id가 없는 점수가 있습니다." };
    }
    if (byId.has(cid)) {
      return { ok: false, error: `기준 '${cid}'의 점수가 중복 입력되었습니다.` };
    }
    const criterion = criteria.find((c) => c.id === cid);
    if (!criterion) {
      // 루브릭에 없는 기준 = 화면과 서버의 루브릭이 어긋난 상태. 저장하면 유령 점수가 남는다.
      return { ok: false, error: `루브릭에 없는 기준입니다: ${cid}` };
    }
    if (!Number.isInteger(item.score)) {
      return { ok: false, error: `'${criterion.name}' 점수는 정수여야 합니다.` };
    }
    if (item.score < 0 || item.score > criterion.max_score) {
      return {
        ok: false,
        error: `'${criterion.name}' 점수는 0~${criterion.max_score} 범위여야 합니다.`,
      };
    }
    byId.set(cid, item.score);
  }

  // 누락된 기준을 0으로 채우면 교사가 의도하지 않은 감점이 된다 → 전 기준 입력을 요구한다.
  const missing = criteria.filter((c) => !byId.has(c.id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `점수가 빠진 기준이 있습니다: ${missing.map((c) => c.name).join(", ")}`,
    };
  }

  return {
    ok: true,
    scores: criteria.map((c) => ({
      criterion_id: c.id,
      score: byId.get(c.id) as number,
    })),
  };
}
