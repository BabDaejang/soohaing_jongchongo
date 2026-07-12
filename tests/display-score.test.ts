import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISPLAY_MAX,
  MIN_INITIAL_GAP,
  SPREAD_BOTTOM,
  SPREAD_TOP,
  assignDisplayScores,
  initialConfirmCount,
  insertBetween,
  spreadScores,
  type RawRankedStudent,
} from "@/lib/scores/display";

// ── initialConfirmCount: 15명 미만 전원 / 15~25 클램프 ────────────────────
test("initialConfirmCount — 미만 전원·25% 클램프", () => {
  assert.equal(initialConfirmCount(3), 3);
  assert.equal(initialConfirmCount(14), 14);
  assert.equal(initialConfirmCount(15), 15); // round(3.75)=4 → clamp 15
  assert.equal(initialConfirmCount(60), 15); // round(15)=15
  assert.equal(initialConfirmCount(100), 25); // round(25)=25
  assert.equal(initialConfirmCount(400), 25); // round(100)=100 → clamp 25
});

// ── spreadScores: 등간격 내림차순 ────────────────────────────────────────
test("spreadScores(1) → [500]", () => {
  assert.deepEqual(spreadScores(1), [500]);
});

test("spreadScores(2) → [800, 200]", () => {
  assert.deepEqual(spreadScores(2), [SPREAD_TOP, SPREAD_BOTTOM]);
});

test("spreadScores(25) — 간격 25·내림차순·경계값", () => {
  const s = spreadScores(25);
  assert.equal(s.length, 25);
  assert.equal(s[0], SPREAD_TOP);
  assert.equal(s[24], SPREAD_BOTTOM);
  for (let i = 1; i < s.length; i++) assert.equal(s[i - 1] - s[i], 25);
});

test("spreadScores(41) — 간격 15(= MIN_INITIAL_GAP)", () => {
  const s = spreadScores(41);
  assert.equal(s.length, 41);
  for (let i = 1; i < s.length; i++) {
    assert.equal(s[i - 1] - s[i], MIN_INITIAL_GAP);
  }
});

// ── insertBetween: 이웃 사이 삽입 ────────────────────────────────────────
test("insertBetween — 둘 다 있으면 중간값", () => {
  assert.equal(insertBetween(800, 600), 700);
  assert.equal(insertBetween(600, 800), 700); // min/max 정규화
});

test("insertBetween — 최상위 진입 = (최고+999)/2", () => {
  assert.equal(insertBetween(null, 800), Math.round((800 + DISPLAY_MAX) / 2)); // 900
});

test("insertBetween — 최하위 진입 = 최저/2", () => {
  assert.equal(insertBetween(200, null), 100);
});

test("insertBetween — 이웃 붙음(정수 여유 없음) → null", () => {
  assert.equal(insertBetween(416, 415), null);
  assert.equal(insertBetween(415, 415), null);
});

// ── assignDisplayScores ─────────────────────────────────────────────────
function ranked(pairs: [string, number][]): RawRankedStudent[] {
  return pairs.map(([studentId, raw]) => ({ studentId, raw }));
}

test("미달 국면 — 빈 Map·confirmed=false", () => {
  const rawRanked = ranked([
    ["a", 90],
    ["b", 80],
    ["c", 70],
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map(),
    totalTargets: 20, // 초기 확정 인원 15 > 3
  });
  assert.equal(res.confirmed, false);
  assert.equal(res.respread, false);
  assert.equal(res.displays.size, 0);
});

test("초기 확정 — 전원 배정·동점 그룹 동일 점수", () => {
  // 대상 3명, total<15 → 전원 확정. 동점(b,c) → 같은 표시 점수.
  const rawRanked = ranked([
    ["a", 90],
    ["b", 80],
    ["c", 80],
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map(),
    totalTargets: 3,
  });
  assert.equal(res.confirmed, true);
  assert.equal(res.displays.size, 3);
  const s = spreadScores(3); // [800, 500, 200]
  assert.equal(res.displays.get("a"), s[0]);
  // 동점 b,c는 그룹 첫 위치(index 1)의 값으로 통일
  assert.equal(res.displays.get("b"), s[1]);
  assert.equal(res.displays.get("c"), s[1]);
});

test("신규 중간 삽입 — 이웃 중간값", () => {
  // 기존 a=800, c=200. 신규 b(raw 사이) → 삽입 500.
  const rawRanked = ranked([
    ["a", 90],
    ["b", 60],
    ["c", 30],
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map([
      ["a", 800],
      ["c", 200],
    ]),
    totalTargets: 3,
  });
  assert.equal(res.confirmed, true);
  assert.equal(res.respread, false);
  assert.equal(res.displays.get("a"), 800); // sticky
  assert.equal(res.displays.get("c"), 200); // sticky
  assert.equal(res.displays.get("b"), 500);
});

test("최상위 신규 진입 = (기존 최고+999)/2", () => {
  const rawRanked = ranked([
    ["z", 99], // 신규 최상위
    ["a", 90],
    ["c", 30],
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map([
      ["a", 800],
      ["c", 200],
    ]),
    totalTargets: 3,
  });
  assert.equal(res.displays.get("z"), Math.round((800 + DISPLAY_MAX) / 2)); // 900
});

test("최하위 신규 진입 = 기존 최저/2", () => {
  const rawRanked = ranked([
    ["a", 90],
    ["c", 30],
    ["y", 10], // 신규 최하위
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map([
      ["a", 800],
      ["c", 200],
    ]),
    totalTargets: 3,
  });
  assert.equal(res.displays.get("y"), 100); // 200/2
});

test("신규 동점 = anchor와 동일 점수", () => {
  const rawRanked = ranked([
    ["a", 90],
    ["b", 90], // 신규, a와 동점
    ["c", 30],
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map([
      ["a", 800],
      ["c", 200],
    ]),
    totalTargets: 3,
  });
  assert.equal(res.displays.get("b"), 800); // a와 동일
});

test("이웃 붙음 → respread·순서 보존·전원 배정", () => {
  // 기존 a=416, c=415(붙음). 신규 b가 사이에 들어갈 정수 여유 없음 → 전체 재배치.
  const rawRanked = ranked([
    ["a", 90],
    ["b", 60],
    ["c", 30],
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map([
      ["a", 416],
      ["c", 415],
    ]),
    totalTargets: 3,
  });
  assert.equal(res.confirmed, true);
  assert.equal(res.respread, true);
  assert.equal(res.displays.size, 3);
  // 재스프레드 = rawRanked 순서(내림차순) 보존
  const s = spreadScores(3); // [800, 500, 200]
  assert.equal(res.displays.get("a"), s[0]);
  assert.equal(res.displays.get("b"), s[1]);
  assert.equal(res.displays.get("c"), s[2]);
  assert.ok(res.displays.get("a")! > res.displays.get("b")!);
  assert.ok(res.displays.get("b")! > res.displays.get("c")!);
});

test("existing의 탈락자 제거 — rawRanked에 없는 학생 무시", () => {
  // gone은 existing에 있으나 rawRanked에 없음 → kept에서 제거. a는 sticky 유지.
  const rawRanked = ranked([
    ["a", 90],
    ["c", 30],
  ]);
  const res = assignDisplayScores({
    rawRanked,
    existing: new Map([
      ["a", 800],
      ["gone", 500],
      ["c", 200],
    ]),
    totalTargets: 2,
  });
  assert.equal(res.confirmed, true);
  assert.equal(res.displays.has("gone"), false);
  assert.equal(res.displays.get("a"), 800);
  assert.equal(res.displays.get("c"), 200);
});

test("결정성 — 같은 입력 2회 → 동일 출력", () => {
  const build = () =>
    assignDisplayScores({
      rawRanked: ranked([
        ["a", 90],
        ["b", 60],
        ["c", 30],
      ]),
      existing: new Map([
        ["a", 800],
        ["c", 200],
      ]),
      totalTargets: 3,
    });
  const r1 = build();
  const r2 = build();
  assert.deepEqual([...r1.displays.entries()].sort(), [
    ...r2.displays.entries(),
  ].sort());
});
