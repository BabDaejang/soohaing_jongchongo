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
