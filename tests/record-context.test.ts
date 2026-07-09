import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStudentContext,
  filterRecordSubmissions,
  type ContextSource,
  type RecordSubmissionRow,
} from "@/lib/records/context";

// 가짜 2명(A/B) 제출물 — 혼입 방지(INV-1/INV-2) 교차오염 테스트용.
const ALL_SUBS: RecordSubmissionRow[] = [
  {
    id: "sub-a1",
    content_text: "A의 반영·매칭 제출물",
    source_type: "docx",
    student_id: "A",
    include_in_record: true,
    match_status: "confirmed",
  },
  {
    id: "sub-a2",
    content_text: "A의 미반영 제출물",
    source_type: "docx",
    student_id: "A",
    include_in_record: false, // 반영 해제 → 제외
    match_status: "confirmed",
  },
  {
    id: "sub-a3",
    content_text: "A의 미확정 제출물",
    source_type: "docx",
    student_id: "A",
    include_in_record: true,
    match_status: "pending_confirm", // 매칭 미확정 → 제외
  },
  {
    id: "sub-b1",
    content_text: "B의 제출물 — 절대 A 컨텍스트에 섞이면 안 됨",
    source_type: "docx",
    student_id: "B",
    include_in_record: true,
    match_status: "confirmed",
  },
];

function makeSource(
  list: (studentId: string) => RecordSubmissionRow[],
): ContextSource {
  return {
    async getStudent(studentId) {
      const names: Record<string, string> = { A: "학생가", B: "학생나" };
      if (!names[studentId]) return null;
      return {
        id: studentId,
        name: names[studentId],
        teacher_memo: `${studentId}의 관찰 메모`,
        project_id: "P",
      };
    },
    async listStudentSubmissions(studentId) {
      return list(studentId);
    },
    async getMergedProfile() {
      return { guidelines: [], prohibitions: [] };
    },
    async getRecordSettings() {
      return { charLimit: 500, countMethod: "chars" };
    },
  };
}

test("filterRecordSubmissions: 해당 학생의 반영+매칭 제출물만", () => {
  const a = filterRecordSubmissions(ALL_SUBS, "A");
  assert.deepEqual(
    a.map((s) => s.id),
    ["sub-a1"], // a2(미반영)·a3(미확정)·b1(타 학생) 제외
  );
  const b = filterRecordSubmissions(ALL_SUBS, "B");
  assert.deepEqual(
    b.map((s) => s.id),
    ["sub-b1"],
  );
});

test("buildStudentContext: 단일 studentId 시그니처(INV-1)", () => {
  // (studentId, source) 두 인자 — 학생 배열을 받지 않는다.
  assert.equal(buildStudentContext.length, 2);
});

test("buildStudentContext(A): 타 학생 데이터 미포함(INV-2)", async () => {
  // 올바른 소스: student_id로 스코프.
  const source = makeSource((sid) =>
    ALL_SUBS.filter((s) => s.student_id === sid),
  );
  const ctx = await buildStudentContext("A", source);
  assert.deepEqual(
    ctx.submissions.map((s) => s.id),
    ["sub-a1"],
  );
  assert.equal(ctx.teacherMemo, "A의 관찰 메모");
  const joined = JSON.stringify(ctx);
  assert.ok(!joined.includes("sub-b1"), "B 제출물 id가 섞이면 안 됨");
  assert.ok(!joined.includes("B의 제출물"), "B 내용이 섞이면 안 됨");
});

test("buildStudentContext: 버그로 소스가 전체를 반환해도 방어적 재필터로 A만", async () => {
  // 버그 시뮬레이션: student_id 무시하고 전체 반환.
  const buggySource = makeSource(() => ALL_SUBS);
  const ctx = await buildStudentContext("A", buggySource);
  assert.deepEqual(
    ctx.submissions.map((s) => s.id),
    ["sub-a1"], // filterRecordSubmissions가 타 학생·미반영·미확정을 제거
  );
});
