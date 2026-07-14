import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorksheetLayout,
  applySort,
  applyFilters,
  clampWidth,
  clampRowHeight,
  worksheetFilterValue,
  MIN_COL_WIDTH,
  MAX_COL_WIDTH,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
  DEFAULT_COLUMN_WIDTHS,
} from "@/lib/worksheet/layout";
import type { WorksheetRow } from "@/lib/worksheet/types";

function row(p: Partial<WorksheetRow> & { studentId: string }): WorksheetRow {
  return {
    studentId: p.studentId,
    studentNumber: p.studentNumber ?? null,
    name: p.name ?? "",
    submissionCount: p.submissionCount ?? 0,
    submissions: p.submissions ?? [],
    displayScore: p.displayScore ?? null,
    hasOverride: p.hasOverride ?? false,
    overrideReason: p.overrideReason ?? null,
    grade: p.grade ?? null,
    recordContent: p.recordContent ?? null,
    recordVersion: p.recordVersion ?? null,
    memo: p.memo ?? "",
  };
}

test("clampWidth: min/max 클램프 + 반올림 + 비유한값 폴백", () => {
  assert.equal(clampWidth(10), MIN_COL_WIDTH);
  assert.equal(clampWidth(99999), MAX_COL_WIDTH);
  assert.equal(clampWidth(200.6), 201);
  assert.equal(clampWidth(NaN), DEFAULT_COLUMN_WIDTHS.record);
});

test("clampRowHeight: min/max 클램프 + 비유한값 폴백", () => {
  assert.equal(clampRowHeight(1), MIN_ROW_HEIGHT);
  assert.equal(clampRowHeight(999999), MAX_ROW_HEIGHT);
  assert.equal(clampRowHeight(Infinity), MIN_ROW_HEIGHT);
});

test("normalizeWorksheetLayout: 빈 입력 → 기본 상태", () => {
  const l = normalizeWorksheetLayout(null, ["a", "b"]);
  assert.deepEqual(l.widths, {});
  assert.deepEqual(l.hidden, []);
  assert.equal(l.sort, null);
  assert.deepEqual(l.rowHeights, {});
  assert.equal(l.allCollapsed, false);
});

test("normalizeWorksheetLayout: 구형(results) shape·garbage 방어 → 기본값", () => {
  // 구 results 레이아웃 형태(columnWidths/cells)는 widths/hidden/... 키가 없어 전부 기본값.
  const raw = { columnWidths: { memo: 400 }, cells: { a: { memo: { mode: "full" } } } };
  const l = normalizeWorksheetLayout(raw, ["a"]);
  assert.deepEqual(l.widths, {});
  assert.deepEqual(l.hidden, []);
  assert.equal(l.sort, null);
  assert.deepEqual(l.rowHeights, {});
  // 완전 garbage
  const g = normalizeWorksheetLayout("nonsense", ["a"]);
  assert.equal(g.allCollapsed, false);
});

test("normalizeWorksheetLayout: 너비 클램프·잘못된 sort·hidden 정규화", () => {
  const raw = {
    widths: { score: 5, record: 100000, name: "x" },
    hidden: ["memo", "bogus", "grade"],
    sort: { key: "bogus", dir: "asc" },
    allCollapsed: true,
  };
  const l = normalizeWorksheetLayout(raw, []);
  assert.equal(l.widths.score, MIN_COL_WIDTH);
  assert.equal(l.widths.record, MAX_COL_WIDTH);
  assert.equal("name" in l.widths, false); // 숫자 아님 → 제외
  assert.deepEqual(l.hidden, ["grade", "memo"]); // 유효 키만·열 순서로 정규화
  assert.equal(l.sort, null); // 잘못된 key
  assert.equal(l.allCollapsed, true);
});

test("normalizeWorksheetLayout: stale studentId의 rowHeights 제거", () => {
  const raw = { rowHeights: { a: 100, ghost: 200 } };
  const l = normalizeWorksheetLayout(raw, ["a"]);
  assert.deepEqual(Object.keys(l.rowHeights), ["a"]);
  assert.equal(l.rowHeights.a, 100);
});

test("normalizeWorksheetLayout: 유효 sort 보존", () => {
  const l = normalizeWorksheetLayout({ sort: { key: "score", dir: "desc" } }, []);
  assert.deepEqual(l.sort, { key: "score", dir: "desc" });
});

test("normalizeWorksheetLayout: sub_detail_ 열 너비 보존", () => {
  const raw = {
    widths: { sub_detail_1: 250, score: 100, invalid_col: 300 }
  };
  const l = normalizeWorksheetLayout(raw, []);
  assert.equal(l.widths.sub_detail_1, 250);
  assert.equal(l.widths.score, 100);
  assert.equal("invalid_col" in l.widths, false);
});

test("applySort: sort=null이면 원본 유지", () => {
  const rows = [row({ studentId: "a", name: "가" }), row({ studentId: "b", name: "나" })];
  assert.equal(applySort(rows, null), rows);
});

test("applySort: 숫자 열 오름/내림 + null은 항상 끝", () => {
  const rows = [
    row({ studentId: "a", displayScore: 500 }),
    row({ studentId: "b", displayScore: null }),
    row({ studentId: "c", displayScore: 800 }),
  ];
  const asc = applySort(rows, { key: "score", dir: "asc" }).map((r) => r.studentId);
  assert.deepEqual(asc, ["a", "c", "b"]); // null 끝
  const desc = applySort(rows, { key: "score", dir: "desc" }).map((r) => r.studentId);
  assert.deepEqual(desc, ["c", "a", "b"]); // null 여전히 끝
});

test("applySort: 텍스트 열 localeCompare(ko) + 빈 값 끝", () => {
  const rows = [
    row({ studentId: "a", name: "나" }),
    row({ studentId: "b", name: "" }),
    row({ studentId: "c", name: "가" }),
  ];
  const asc = applySort(rows, { key: "name", dir: "asc" }).map((r) => r.studentId);
  assert.deepEqual(asc, ["c", "a", "b"]); // 가 < 나 < (빈 값)
});

test("applyFilters: 선택값 집합만 남김 + 빈 값 항목", () => {
  const rows = [
    row({ studentId: "a", grade: 1 }),
    row({ studentId: "b", grade: 2 }),
    row({ studentId: "c", grade: null }),
  ];
  const only2 = applyFilters(rows, { grade: ["2"] }).map((r) => r.studentId);
  assert.deepEqual(only2, ["b"]);
  const empty = applyFilters(rows, { grade: [""] }).map((r) => r.studentId);
  assert.deepEqual(empty, ["c"]); // "" = 빈 값(null)
  // 빈 필터 배열은 무시(전체 통과)
  assert.equal(applyFilters(rows, { grade: [] }).length, 3);
});

test("worksheetFilterValue: null/숫자 문자열화", () => {
  const r = row({ studentId: "a", submissionCount: 3, studentNumber: null });
  assert.equal(worksheetFilterValue(r, "submission_count"), "3");
  assert.equal(worksheetFilterValue(r, "student_number"), "");
});
