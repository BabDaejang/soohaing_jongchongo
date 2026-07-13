import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDownloadStamp,
  sanitizeFilename,
  buildWorksheetAoA,
} from "@/lib/worksheet/download";
import { WORKSHEET_COLUMNS } from "@/lib/worksheet/types";
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

test("formatDownloadStamp: yymmddHHmm 10자리(로컬 시간)", () => {
  const d = new Date(2026, 6, 12, 15, 44, 3); // 2026-07-12 15:44 로컬
  assert.equal(formatDownloadStamp(d), "2607121544");
  assert.equal(formatDownloadStamp(d).length, 10);
  // 한 자리 월·일·시·분 zero-pad
  const d2 = new Date(2027, 0, 3, 9, 5, 0); // 2027-01-03 09:05
  assert.equal(formatDownloadStamp(d2), "2701030905");
});

test("sanitizeFilename: 금지 문자 제거·trim, 빈 값은 project", () => {
  assert.equal(sanitizeFilename('통사/9반:평가*"?<>|'), "통사9반평가");
  assert.equal(sanitizeFilename("  Tongsa  "), "Tongsa");
  assert.equal(sanitizeFilename('///'), "project");
  assert.equal(sanitizeFilename(""), "project");
});

test("buildWorksheetAoA: 헤더 8열 + 행 수 + 셀 타입", () => {
  const rows = [
    row({
      studentId: "abcdef123456",
      studentNumber: "10101",
      name: "홍길동",
      submissionCount: 2,
      displayScore: 800,
      grade: 1,
      recordContent: "성실함",
      memo: "관찰 메모",
    }),
    row({ studentId: "zzz", name: "이름만" }), // 값 없는 학생
  ];
  const aoa = buildWorksheetAoA(rows);
  assert.equal(aoa.length, 3); // 헤더 + 2행
  assert.equal(aoa[0].length, WORKSHEET_COLUMNS.length); // 8열
  // 첫 행: ID 전문(잘라내지 않음), 숫자 열은 number 타입
  assert.deepEqual(aoa[1], ["abcdef123456", "10101", "홍길동", 2, 800, 1, "성실함", "관찰 메모"]);
  assert.equal(typeof aoa[1][3], "number"); // submission_count
  assert.equal(typeof aoa[1][4], "number"); // score
  // 값 없는 학생: 학번·점수·등급·생기부는 빈 문자열, 갯수는 숫자 0
  assert.deepEqual(aoa[2], ["zzz", "", "이름만", 0, "", "", "", ""]);
});
