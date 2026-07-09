import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStandings,
  deriveGrade,
  GRADE_BOUNDARIES,
} from "@/lib/grading";
import type { GradingScheme } from "@/lib/supabase/types";

// 서로 다른 점수 N개(내림차순 100,99,...)를 만들어 등급 분포를 센다.
function distinctScores(n: number): number[] {
  return Array.from({ length: n }, (_, i) => n - i);
}

function gradeCounts(
  n: number,
  scheme: GradingScheme,
): number[] {
  const scores = distinctScores(n);
  const standings = computeStandings(scores, scheme, "best_grade");
  const counts = new Array(GRADE_BOUNDARIES[scheme].length).fill(0);
  for (const s of standings) counts[s.grade - 1] += 1;
  return counts;
}

// ── 수용 1: 100명에서 5/9등급 인원이 누적 비율과 정확히 일치 ──────────────
test("100명 · 5등급 → 누적 10/34/66/90/100 인원 = [10,24,32,24,10]", () => {
  const counts = gradeCounts(100, "grade5");
  assert.deepEqual(counts, [10, 24, 32, 24, 10]);
  // 누적 = 경계와 일치
  const cum: number[] = [];
  counts.reduce((a, c, i) => (cum[i] = a + c), 0);
  assert.deepEqual(cum, [10, 34, 66, 90, 100]);
});

test("100명 · 9등급(스테나인) → 누적 4/11/23/40/60/77/89/96/100", () => {
  const counts = gradeCounts(100, "grade9");
  assert.deepEqual(counts, [4, 7, 12, 17, 20, 17, 12, 7, 4]);
  const cum: number[] = [];
  counts.reduce((a, c, i) => (cum[i] = a + c), 0);
  assert.deepEqual(cum, [4, 11, 23, 40, 60, 77, 89, 96, 100]);
});

// ── 수용 1: 30명에서도 누적 비율 규칙과 일치(정수 경계) ───────────────────
test("30명 · 5등급 → [3,7,9,8,3], 각 등급 누적%가 경계 이하", () => {
  const counts = gradeCounts(30, "grade5");
  assert.deepEqual(counts, [3, 7, 9, 8, 3]);
  // 각 등급까지의 누적 비율이 해당 경계를 넘지 않는다(= "누적 비율과 일치").
  const boundaries = GRADE_BOUNDARIES.grade5;
  let acc = 0;
  counts.forEach((c, i) => {
    acc += c;
    assert.ok((acc / 30) * 100 <= boundaries[i] + 1e-9, `등급 ${i + 1} 누적 초과`);
  });
});

test("30명 · 9등급 → [1,2,3,6,6,5,3,2,2], 각 등급 누적%가 경계 이하", () => {
  const counts = gradeCounts(30, "grade9");
  assert.deepEqual(counts, [1, 2, 3, 6, 6, 5, 3, 2, 2]);
  const boundaries = GRADE_BOUNDARIES.grade9;
  let acc = 0;
  counts.forEach((c, i) => {
    acc += c;
    assert.ok((acc / 30) * 100 <= boundaries[i] + 1e-9, `등급 ${i + 1} 누적 초과`);
  });
});

// ── 수용 2: 결정성 — 동일 입력 재계산 시 동일 결과 ──────────────────────
test("동일 입력 재계산 시 동일 결과(결정성)", () => {
  const scores = [88, 91, 73, 91, 60, 45, 91, 30];
  const a = computeStandings(scores, "grade5", "best_grade");
  const b = computeStandings(scores, "grade5", "best_grade");
  assert.deepEqual(a, b);
});

// ── 동점자 처리: best_grade vs mid_rank ────────────────────────────────
test("동점군은 경쟁 석차(min position)를 rank로 부여", () => {
  // 상위 2명 동점(100). 세 번째(90)는 석차 3.
  const scores = [100, 100, 90, 80, 70, 60, 50, 40, 30, 20];
  const st = computeStandings(scores, "grade5", "best_grade");
  assert.equal(st[0].rank, 1);
  assert.equal(st[1].rank, 1);
  assert.equal(st[2].rank, 3); // 동점 2명 다음은 3위
});

test("best_grade는 동점군에 상위 등급, mid_rank는 중간석차 등급", () => {
  const scores = [100, 100, 90, 80, 70, 60, 50, 40, 30, 20]; // n=10, 상위 2명 동점
  const best = computeStandings(scores, "grade5", "best_grade");
  const mid = computeStandings(scores, "grade5", "mid_rank");
  // best_grade: pr=1 → pct 10 → 1등급
  assert.equal(best[0].grade, 1);
  assert.equal(best[1].grade, 1);
  // mid_rank: pr=1.5 → pct 15 → 2등급 (동점이 불리)
  assert.equal(mid[0].grade, 2);
  assert.equal(mid[1].grade, 2);
});

// ── deriveGrade 경계값 직접 검증 ───────────────────────────────────────
test("deriveGrade 경계값: 정확히 경계면 해당 등급", () => {
  // 100명 중 석차 10 → pct 10 → 1등급(<=10), 석차 11 → 2등급
  assert.equal(deriveGrade(10, 100, "grade5"), 1);
  assert.equal(deriveGrade(11, 100, "grade5"), 2);
  assert.equal(deriveGrade(34, 100, "grade5"), 2);
  assert.equal(deriveGrade(35, 100, "grade5"), 3);
  assert.equal(deriveGrade(100, 100, "grade5"), 5);
});
