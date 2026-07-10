import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMatch,
  containsToken,
  deriveIdentityFromFilename,
  fileBasename,
  type StudentRef,
} from "@/lib/matching";

const s = (id: string, no: string | null, name: string): StudentRef => ({
  id,
  student_number: no,
  name,
});

// ── classifyMatch (SPEC 5.2 개정) ────────────────────────────────────

test("(a) 학번 완전 일치 → 기존 학생 자동 귀속", () => {
  const out = classifyMatch({
    rawStudentNo: "10101",
    rawStudentName: "홍길동",
    byNumber: s("stu-1", "10101", "홍길동"),
    byName: [],
    identitySource: "column",
  });
  assert.deepEqual(out, { action: "auto_existing", studentId: "stu-1", method: "auto_number" });
});

test("(b) 이름이 명단에 정확히 1명만 일치 → 자동 귀속(auto_name)", () => {
  const out = classifyMatch({
    rawStudentNo: null,
    rawStudentName: "유일한이름",
    byNumber: null,
    byName: [s("stu-9", "10999", "유일한이름")],
    identitySource: "filename",
  });
  assert.deepEqual(out, { action: "auto_existing", studentId: "stu-9", method: "auto_name" });
});

test("(b) 동명이인(2명 이상 일치)은 절대 자동 귀속하지 않는다 — 혼입 방지의 핵심", () => {
  const out = classifyMatch({
    rawStudentNo: null,
    rawStudentName: "김철수",
    byNumber: null,
    byName: [s("stu-2", "10102", "김철수"), s("stu-3", "10203", "김철수")],
    identitySource: "column",
  });
  assert.equal(out.action, "pending");
  if (out.action !== "pending") throw new Error("unreachable");
  assert.equal(out.reason, "name");
  assert.equal(out.candidates.length, 2);
});

test("(b) 이름이 명단에 없으면 pending(name), 후보 없음", () => {
  const out = classifyMatch({
    rawStudentNo: null,
    rawStudentName: "명단에없는이름",
    byNumber: null,
    byName: [],
    identitySource: "llm",
  });
  assert.equal(out.action, "pending");
  if (out.action !== "pending") throw new Error("unreachable");
  assert.equal(out.reason, "name");
  assert.deepEqual(out.candidates, []);
});

test("(d) column 출처의 신규 학번 → 학생 자동 생성 경로", () => {
  const out = classifyMatch({
    rawStudentNo: "99999",
    rawStudentName: "새학생",
    byNumber: null,
    byName: [],
    identitySource: "column",
  });
  assert.deepEqual(out, { action: "auto_new_number", method: "auto_new_number" });
});

test("(c) 파일명·LLM 유래 신규 학번으로는 학생을 만들지 않는다 — 유령 학생 방지", () => {
  for (const source of ["filename", "llm"] as const) {
    const out = classifyMatch({
      rawStudentNo: "99999",
      rawStudentName: null,
      byNumber: null,
      byName: [],
      identitySource: source,
    });
    assert.equal(out.action, "pending");
    if (out.action !== "pending") throw new Error("unreachable");
    assert.equal(out.reason, "number_unknown");
  }
});

test("(d) 신규 학번인데 이름이 명단의 다른 학생과 일치 → 학번 오타 의심, 확인 큐", () => {
  const out = classifyMatch({
    rawStudentNo: "99999", // 명단에 없는 학번
    rawStudentName: "홍길동",
    byNumber: null,
    byName: [s("stu-1", "10101", "홍길동")], // 같은 이름의 기존 학생
    identitySource: "column",
  });
  assert.equal(out.action, "pending");
  if (out.action !== "pending") throw new Error("unreachable");
  assert.equal(out.reason, "number_conflict");
  assert.equal(out.candidates.length, 1);
});

test("(e) 식별값 없음 → pending(none), 후보 없음", () => {
  const out = classifyMatch({
    rawStudentNo: null,
    rawStudentName: null,
    byNumber: null,
    byName: [],
    identitySource: null,
  });
  assert.deepEqual(out, { action: "pending", reason: "none", candidates: [] });
});

test("공백만 있는 식별값은 없는 것으로 취급 → pending(none)", () => {
  const out = classifyMatch({
    rawStudentNo: "   ",
    rawStudentName: "",
    byNumber: null,
    byName: [],
    identitySource: "column",
  });
  assert.equal(out.action, "pending");
});

// ── 파일명 × 명단 교차 대조 ──────────────────────────────────────────

const roster: StudentRef[] = [
  s("stu-1", "10101", "홍길동"),
  s("stu-2", "10102", "김철수"),
  s("stu-3", "10203", "이서"),
  s("stu-4", "10204", "이서준"),
];

test("fileBasename: 경로와 확장자를 떼어낸다", () => {
  assert.equal(fileBasename("a/b/10101_홍길동.docx"), "10101_홍길동");
  assert.equal(fileBasename("이름없음"), "이름없음");
  assert.equal(fileBasename(".gitignore"), ".gitignore"); // 앞점 파일은 통째로
});

test("containsToken: 숫자는 숫자 경계, 한글은 한글 경계로 판정", () => {
  assert.equal(containsToken("10101_홍길동", "10101"), true);
  assert.equal(containsToken("210101_홍길동", "10101"), false); // 더 긴 숫자의 일부
  assert.equal(containsToken("홍길동_과제", "홍길동"), true);
  assert.equal(containsToken("이서준_과제", "이서"), false); // 더 긴 이름의 일부
});

test("파일명에서 학번+이름을 뽑는다", () => {
  assert.deepEqual(deriveIdentityFromFilename("10101_홍길동_수행평가.docx", roster), {
    studentNo: "10101",
    studentName: "홍길동",
  });
});

test("이름만 있는 파일명도 인정한다", () => {
  assert.deepEqual(deriveIdentityFromFilename("홍길동.pdf", roster), {
    studentNo: null,
    studentName: "홍길동",
  });
});

test("명단에 없는 한글 토큰(수행평가·최종)은 이름으로 오인하지 않는다", () => {
  assert.deepEqual(deriveIdentityFromFilename("수행평가최종.docx", roster), {
    studentNo: null,
    studentName: null,
  });
});

test("서로 다른 학생 둘 이상이 걸리면 포기한다(모둠 과제 등)", () => {
  assert.deepEqual(deriveIdentityFromFilename("홍길동_김철수_모둠.docx", roster), {
    studentNo: null,
    studentName: null,
  });
});

test("학번과 이름이 같은 학생을 가리키면 한 명으로 센다", () => {
  assert.deepEqual(deriveIdentityFromFilename("홍길동(10101).pdf", roster), {
    studentNo: "10101",
    studentName: "홍길동",
  });
});

test("학번과 이름이 서로 다른 학생을 가리키면 포기한다", () => {
  assert.deepEqual(deriveIdentityFromFilename("10101_김철수.docx", roster), {
    studentNo: null,
    studentName: null,
  });
});

test("이름 부분 일치는 잡지 않는다 — 이서준 파일이 이서에게 가지 않는다", () => {
  assert.deepEqual(deriveIdentityFromFilename("이서준_보고서.docx", roster), {
    studentNo: null,
    studentName: "이서준",
  });
});

test("파일명이 없으면 빈 결과", () => {
  assert.deepEqual(deriveIdentityFromFilename(null, roster), {
    studentNo: null,
    studentName: null,
  });
});
