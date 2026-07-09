import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMatch, type StudentRef } from "@/lib/matching";

const s = (id: string, no: string | null, name: string): StudentRef => ({
  id,
  student_number: no,
  name,
});

test("(a) 학번 완전 일치 → 기존 학생 자동 귀속", () => {
  const out = classifyMatch({
    rawStudentNo: "10101",
    rawStudentName: "홍길동",
    byNumber: s("stu-1", "10101", "홍길동"),
    byName: [],
  });
  assert.deepEqual(out, { action: "auto_existing", studentId: "stu-1", method: "auto_number" });
});

test("(d) 학번 신규 검출 → 자동 신규 생성 경로", () => {
  const out = classifyMatch({
    rawStudentNo: "99999",
    rawStudentName: "새학생",
    byNumber: null,
    byName: [],
  });
  assert.deepEqual(out, { action: "auto_new_number", method: "auto_new_number" });
});

test("(b) 이름만 일치(학번 없음) → 절대 자동 아님, pending(동명이인 후보 제시) — 수용 1·2", () => {
  const out = classifyMatch({
    rawStudentNo: null,
    rawStudentName: "김철수",
    byNumber: null,
    byName: [s("stu-2", "10102", "김철수"), s("stu-3", "10203", "김철수")],
  });
  assert.equal(out.action, "pending");
  if (out.action !== "pending") throw new Error("unreachable");
  assert.equal(out.reason, "name");
  assert.equal(out.candidates.length, 2);
});

test("(b) 이름만 있고 정확히 1명 일치여도 자동 병합하지 않는다 — 수용 2", () => {
  const out = classifyMatch({
    rawStudentNo: null,
    rawStudentName: "유일한이름",
    byNumber: null,
    byName: [s("stu-9", "10999", "유일한이름")],
  });
  assert.equal(out.action, "pending"); // 자동 귀속 아님
});

test("(c) 식별값 없음 → pending(none), 후보 없음", () => {
  const out = classifyMatch({
    rawStudentNo: null,
    rawStudentName: null,
    byNumber: null,
    byName: [],
  });
  assert.deepEqual(out, { action: "pending", reason: "none", candidates: [] });
});

test("공백만 있는 식별값은 없는 것으로 취급 → pending(none)", () => {
  const out = classifyMatch({
    rawStudentNo: "   ",
    rawStudentName: "",
    byNumber: null,
    byName: [],
  });
  assert.equal(out.action, "pending");
});
