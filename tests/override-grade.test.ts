import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeStandings,
  overrideRangeForGrade,
  GRADE_BOUNDARIES,
} from "@/lib/grading";
import type { GradingScheme, TieBreak } from "@/lib/supabase/types";

// 목표 등급 → 보정 점수 구간 (리팩토링 4 배치 4, P-4).
// INV-6은 그대로다: 이 함수는 **점수**만 계산하고 등급을 저장하지 않는다.
// 계산이 맞는지는 "구간 안의 점수를 실제로 넣으면 그 등급이 나오는가"로 검증한다.

// 후보 점수를 끼웠을 때 그 학생의 등급(헬퍼와 독립적으로 재계산해 교차 검증).
function gradeOf(
  others: number[],
  candidate: number,
  scheme: GradingScheme,
  tieBreak: TieBreak,
): number {
  const st = computeStandings([...others, candidate], scheme, tieBreak);
  return st[st.length - 1].grade;
}

// 0..999 전 구간을 훑어 실제로 targetGrade가 되는 정수 구간을 구한다(느리지만 정확한 기준).
function bruteRange(
  others: number[],
  scheme: GradingScheme,
  tieBreak: TieBreak,
  target: number,
): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (let c = 0; c <= 999; c++) {
    if (gradeOf(others, c, scheme, tieBreak) === target) {
      if (min === null) min = c;
      max = c;
    }
  }
  return min === null || max === null ? null : { min, max };
}

// ── 수용 1: 5등급 — 구간이 실제 등급과 일치한다 ─────────────────────────
test("5등급: 20명 사이에 끼어들 때 목표 등급 구간이 완전 탐색 결과와 일치", () => {
  const others = Array.from({ length: 20 }, (_, i) => (i + 1) * 40); // 40..800
  for (let g = 1; g <= 5; g++) {
    const got = overrideRangeForGrade(others, "grade5", "best_grade", g);
    assert.deepEqual(got, bruteRange(others, "grade5", "best_grade", g), `등급 ${g}`);
  }
});

// ── 수용 2: 9등급도 동일 ────────────────────────────────────────────────
test("9등급: 전 등급 구간이 완전 탐색 결과와 일치", () => {
  const others = Array.from({ length: 30 }, (_, i) => (i + 1) * 25);
  for (let g = 1; g <= 9; g++) {
    const got = overrideRangeForGrade(others, "grade9", "best_grade", g);
    assert.deepEqual(got, bruteRange(others, "grade9", "best_grade", g), `등급 ${g}`);
  }
});

// ── 수용 3: 구간 안의 점수를 실제로 넣으면 그 등급이 나온다 ─────────────
test("구간의 min·max·중앙값 어디를 써도 목표 등급이 나온다", () => {
  const others = [900, 800, 700, 600, 500, 400, 300, 200, 100, 50];
  const target = 2;
  const r = overrideRangeForGrade(others, "grade5", "best_grade", target);
  assert.ok(r, "구간이 있어야 한다");
  for (const c of [r.min, r.max, Math.floor((r.min + r.max) / 2)]) {
    assert.equal(gradeOf(others, c, "grade5", "best_grade"), target, `점수 ${c}`);
  }
});

// ── 수용 4: 경계 바깥은 목표 등급이 아니다 ──────────────────────────────
test("구간 바로 바깥(min-1 · max+1)은 다른 등급이다", () => {
  const others = Array.from({ length: 25 }, (_, i) => i * 30 + 10);
  const target = 3;
  const r = overrideRangeForGrade(others, "grade5", "best_grade", target);
  assert.ok(r);
  if (r.min > 0) {
    assert.notEqual(gradeOf(others, r.min - 1, "grade5", "best_grade"), target);
  }
  if (r.max < 999) {
    assert.notEqual(gradeOf(others, r.max + 1, "grade5", "best_grade"), target);
  }
});

// ── 수용 5: 동점 처리 양쪽 모두 동작한다 ────────────────────────────────
test("mid_rank에서도 구간이 완전 탐색과 일치한다", () => {
  const others = [500, 500, 500, 400, 400, 300, 200, 100];
  for (let g = 1; g <= 5; g++) {
    assert.deepEqual(
      overrideRangeForGrade(others, "grade5", "mid_rank", g),
      bruteRange(others, "grade5", "mid_rank", g),
      `등급 ${g}`,
    );
  }
});

test("동점 무리에 끼어드는 경우 best_grade와 mid_rank의 구간이 다를 수 있다", () => {
  const others = [500, 500, 500, 500, 400, 300, 200, 100, 90, 80];
  const best = overrideRangeForGrade(others, "grade5", "best_grade", 1);
  const mid = overrideRangeForGrade(others, "grade5", "mid_rank", 1);
  // 둘 다 계산은 되어야 하고, 각자 자기 규칙과 일치해야 한다.
  assert.deepEqual(best, bruteRange(others, "grade5", "best_grade", 1));
  assert.deepEqual(mid, bruteRange(others, "grade5", "mid_rank", 1));
});

// ── 수용 6: 불가능한 등급은 null ────────────────────────────────────────
test("소인원에서 비는 등급은 null('현재 인원 기준 불가')", () => {
  // 2명뿐이면 9등급 중 대부분은 아무 점수로도 만들 수 없다.
  const others = [500];
  const impossible: number[] = [];
  for (let g = 1; g <= 9; g++) {
    if (overrideRangeForGrade(others, "grade9", "best_grade", g) === null) {
      impossible.push(g);
    }
  }
  assert.ok(impossible.length > 0, "불가능한 등급이 있어야 한다");
  for (const g of impossible) {
    assert.equal(bruteRange(others, "grade9", "best_grade", g), null, `등급 ${g}`);
  }
});

test("등급 번호가 스킴 범위를 벗어나면 null", () => {
  const others = [100, 200, 300];
  assert.equal(overrideRangeForGrade(others, "grade5", "best_grade", 0), null);
  assert.equal(overrideRangeForGrade(others, "grade5", "best_grade", 6), null);
  assert.equal(overrideRangeForGrade(others, "grade9", "best_grade", 10), null);
  assert.equal(overrideRangeForGrade(others, "grade5", "best_grade", 2.5), null);
});

// ── 수용 7: 단조성 스팟 체크(이진 탐색의 전제) ──────────────────────────
test("점수가 오르면 등급 번호는 절대 커지지 않는다(단조 — 이진 탐색 전제)", () => {
  const cases: { others: number[]; scheme: GradingScheme; tie: TieBreak }[] = [
    { others: [900, 700, 700, 500, 300, 100], scheme: "grade5", tie: "best_grade" },
    { others: [900, 700, 700, 500, 300, 100], scheme: "grade5", tie: "mid_rank" },
    { others: Array.from({ length: 40 }, (_, i) => i * 20), scheme: "grade9", tie: "mid_rank" },
  ];
  for (const { others, scheme, tie } of cases) {
    let prev = Number.POSITIVE_INFINITY;
    for (let c = 0; c <= 999; c += 7) {
      const g = gradeOf(others, c, scheme, tie);
      assert.ok(g <= prev, `점수 ${c}에서 등급이 나빠짐(${prev} → ${g})`);
      prev = g;
    }
  }
});

// ── 수용 8: 혼자뿐일 때(다른 학생 없음) ────────────────────────────────
// 주의: 1명뿐이면 백분위가 100%라 **최하 등급**이 된다(deriveGrade의 기존 의미 — 상대평가에서
// 모집단이 1명이면 상위 10%가 성립하지 않는다). 헬퍼는 그 현실을 그대로 반영해야 한다.
test("다른 학생이 없으면 어떤 점수든 최하 등급이고 나머지 등급은 불가", () => {
  const bottom = GRADE_BOUNDARIES.grade5.length; // 5
  assert.equal(gradeOf([], 0, "grade5", "best_grade"), bottom);
  assert.equal(gradeOf([], 999, "grade5", "best_grade"), bottom);

  assert.deepEqual(overrideRangeForGrade([], "grade5", "best_grade", bottom), {
    min: 0,
    max: 999,
  });
  for (let g = 1; g < bottom; g++) {
    assert.equal(
      overrideRangeForGrade([], "grade5", "best_grade", g),
      null,
      `등급 ${g}는 1인 모집단에서 불가능`,
    );
  }
});
