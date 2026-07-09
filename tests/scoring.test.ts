import { test } from "node:test";
import assert from "node:assert/strict";
import { submissionScore, aggregateComposite } from "@/lib/scoring";
import type { RubricCriterion } from "@/lib/supabase/types";

const criteria: RubricCriterion[] = [
  { id: "a", name: "A", description: "", max_score: 10, weight: 2 },
  { id: "b", name: "B", description: "", max_score: 10, weight: 1 },
];

test("submissionScore: weighted는 Σ(점수×weight)", () => {
  const scores = [
    { criterion_id: "a", score: 3 },
    { criterion_id: "b", score: 4 },
  ];
  assert.equal(submissionScore(scores, criteria, "weighted"), 3 * 2 + 4 * 1); // 10
});

test("submissionScore: sum/avg는 단순합(=total_score)", () => {
  const scores = [
    { criterion_id: "a", score: 3 },
    { criterion_id: "b", score: 4 },
  ];
  assert.equal(submissionScore(scores, criteria, "sum"), 7);
  assert.equal(submissionScore(scores, criteria, "avg"), 7);
});

test("submissionScore: 알 수 없는 기준 weight는 1로 폴백", () => {
  const scores = [{ criterion_id: "x", score: 5 }];
  assert.equal(submissionScore(scores, criteria, "weighted"), 5);
});

test("aggregateComposite: sum=합, avg=평균, weighted=평균", () => {
  assert.equal(aggregateComposite([10, 20], "sum"), 30);
  assert.equal(aggregateComposite([10, 20], "avg"), 15);
  assert.equal(aggregateComposite([10, 20], "weighted"), 15);
});

test("aggregateComposite: 빈 입력 → 0", () => {
  assert.equal(aggregateComposite([], "avg"), 0);
});

test("결정성: 동일 입력 → 동일 출력(수용 2)", () => {
  const scores = [
    { criterion_id: "a", score: 7 },
    { criterion_id: "b", score: 9 },
  ];
  const one = submissionScore(scores, criteria, "weighted");
  const two = submissionScore(scores, criteria, "weighted");
  assert.equal(one, two);
  assert.equal(
    aggregateComposite([one, 12, 8], "avg"),
    aggregateComposite([one, 12, 8], "avg"),
  );
});
