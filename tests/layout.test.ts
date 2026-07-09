import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLayout,
  setAllCellModes,
  withMode,
  clampColumnWidth,
  clampCellHeight,
  DEFAULT_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_CELL_HEIGHT,
  MAX_CELL_HEIGHT,
  DEFAULT_CUSTOM_HEIGHT,
} from "@/lib/records/layout";

test("clampColumnWidth: min/max 클램프 + 반올림 + 비유한값 폴백", () => {
  assert.equal(clampColumnWidth(10), MIN_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(99999), MAX_COLUMN_WIDTH);
  assert.equal(clampColumnWidth(200.6), 201);
  assert.equal(clampColumnWidth(NaN), DEFAULT_COLUMN_WIDTHS.memo);
});

test("clampCellHeight: min/max 클램프 + 비유한값 폴백", () => {
  assert.equal(clampCellHeight(1), MIN_CELL_HEIGHT);
  assert.equal(clampCellHeight(999999), MAX_CELL_HEIGHT);
  assert.equal(clampCellHeight(Infinity), DEFAULT_CUSTOM_HEIGHT);
});

test("normalizeLayout: 기본값 채움(빈 입력)", () => {
  const s = normalizeLayout(null, ["a", "b"]);
  assert.deepEqual(s.columnWidths, DEFAULT_COLUMN_WIDTHS);
  assert.deepEqual(Object.keys(s.cells).sort(), ["a", "b"]);
  assert.deepEqual(s.cells.a, { memo: { mode: "collapsed" }, record: { mode: "collapsed" } });
});

test("normalizeLayout: 존재하지 않는 studentId(stale) 제거 + 누락 학생 기본값", () => {
  const raw = {
    columnWidths: { memo: 400 },
    cells: {
      gone: { memo: { mode: "full" }, record: { mode: "full" } }, // 목록에 없는 학생
      a: { memo: { mode: "full" }, record: { mode: "custom", height: 200 } },
    },
  };
  const s = normalizeLayout(raw, ["a", "b"]);
  assert.deepEqual(Object.keys(s.cells).sort(), ["a", "b"]); // gone 제거, b 추가
  assert.equal(s.cells.a.memo.mode, "full");
  assert.deepEqual(s.cells.a.record, { mode: "custom", height: 200 });
  assert.deepEqual(s.cells.b, { memo: { mode: "collapsed" }, record: { mode: "collapsed" } });
  assert.equal(s.columnWidths.memo, 400);
  assert.equal(s.columnWidths.student, DEFAULT_COLUMN_WIDTHS.student); // 미지정 열 기본값
});

test("normalizeLayout: 잘못된 값 방어(garbage) — 폴백", () => {
  const raw = {
    columnWidths: { memo: "wide", record: -50, grade: 5000 },
    cells: {
      a: { memo: { mode: "bogus" }, record: "nope" },
      b: 42,
    },
  };
  const s = normalizeLayout(raw, ["a", "b"]);
  assert.equal(s.columnWidths.memo, DEFAULT_COLUMN_WIDTHS.memo); // 문자열 → 기본값
  assert.equal(s.columnWidths.record, MIN_COLUMN_WIDTH); // 음수 → 클램프
  assert.equal(s.columnWidths.grade, MAX_COLUMN_WIDTH); // 초과 → 클램프
  assert.equal(s.cells.a.memo.mode, "collapsed"); // 잘못된 모드 → 기본값
  assert.equal(s.cells.a.record.mode, "collapsed"); // 문자열 셀 → 기본값
  assert.deepEqual(s.cells.b, { memo: { mode: "collapsed" }, record: { mode: "collapsed" } });
});

test("normalizeLayout: custom이 아닌 모드의 height는 제거", () => {
  const raw = {
    cells: { a: { memo: { mode: "full", height: 300 }, record: { mode: "collapsed", height: 99 } } },
  };
  const s = normalizeLayout(raw, ["a"]);
  assert.equal(s.cells.a.memo.height, undefined);
  assert.equal(s.cells.a.record.height, undefined);
});

test("normalizeLayout: custom 셀의 잘못된 height는 클램프/기본값", () => {
  const raw = {
    cells: {
      a: { memo: { mode: "custom", height: 5 }, record: { mode: "custom" } },
    },
  };
  const s = normalizeLayout(raw, ["a"]);
  assert.equal(s.cells.a.memo.height, MIN_CELL_HEIGHT); // 5 → 클램프
  assert.equal(s.cells.a.record.height, DEFAULT_CUSTOM_HEIGHT); // 없음 → 기본
});

test("withMode: custom 전환 시 height 확보/유지, 다른 모드 전환 시 제거", () => {
  assert.deepEqual(withMode({ mode: "collapsed" }, "custom"), {
    mode: "custom",
    height: DEFAULT_CUSTOM_HEIGHT,
  });
  assert.deepEqual(withMode({ mode: "custom", height: 250 }, "custom"), {
    mode: "custom",
    height: 250,
  });
  assert.deepEqual(withMode({ mode: "custom", height: 250 }, "full"), { mode: "full" });
});

test("setAllCellModes: 모든 행의 두 셀을 일괄 변경(전체 접기/펼치기)", () => {
  const base = normalizeLayout(
    { cells: { a: { memo: { mode: "custom", height: 200 }, record: { mode: "collapsed" } } } },
    ["a", "b"],
  );
  const full = setAllCellModes(base, ["a", "b"], "full");
  assert.equal(full.cells.a.memo.mode, "full");
  assert.equal(full.cells.a.record.mode, "full");
  assert.equal(full.cells.b.memo.mode, "full");
  assert.equal(full.columnWidths.memo, base.columnWidths.memo); // 열 너비는 불변

  const collapsed = setAllCellModes(full, ["a", "b"], "collapsed");
  assert.equal(collapsed.cells.a.memo.mode, "collapsed");
  assert.equal(collapsed.cells.b.record.mode, "collapsed");
});
