import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_UNASSIGNED,
  unassignedSummary,
  unassignedTotal,
} from "@/lib/worksheet/unassigned";
import { assembleWorksheetRows, type SubmissionRaw } from "@/lib/worksheet/assemble";

// 작업결과표 허브화 (리팩토링 4 배치 3, P-2).
// ① 미귀속 제출물은 표에 행이 없으므로 배너 카운트가 유일한 존재 증거다.
// ② 제출물 펼침의 매칭 배지·[학생 이동]은 조립된 서브행 필드에 의존한다.

// ── 배너 카운트 조립 ─────────────────────────────────────────────────────
test("배너: 미매칭·확인 대기를 더해 총합을 낸다", () => {
  assert.equal(unassignedTotal({ unmatched: 3, pending: 2 }), 5);
});

test("배너: 0건이면 총합 0 · 요약 문구는 빈 문자열(배너 미표시 조건)", () => {
  assert.equal(unassignedTotal(EMPTY_UNASSIGNED), 0);
  assert.equal(unassignedSummary(EMPTY_UNASSIGNED), "");
});

test("배너: 음수·비유한값은 0으로 방어한다(count가 null일 때)", () => {
  assert.equal(unassignedTotal({ unmatched: -1, pending: Number.NaN }), 0);
  assert.equal(unassignedSummary({ unmatched: -1, pending: Number.NaN }), "");
});

test("배너: 한쪽만 있으면 그 갈래만 문구에 넣는다", () => {
  assert.equal(unassignedSummary({ unmatched: 4, pending: 0 }), "미매칭 4건");
  assert.equal(unassignedSummary({ unmatched: 0, pending: 2 }), "확인 대기 2건");
});

test("배너: 둘 다 있으면 가운뎃점으로 잇는다", () => {
  assert.equal(
    unassignedSummary({ unmatched: 3, pending: 2 }),
    "미매칭 3건 · 확인 대기 2건",
  );
});

// ── assemble 확장 ────────────────────────────────────────────────────────
const student = {
  id: "st1",
  student_number: "10203",
  name: "홍길동",
  teacher_memo: null,
  score_override: null,
  override_reason: null,
};

function sub(over: Partial<SubmissionRaw> = {}): SubmissionRaw {
  return {
    id: "sub1",
    student_id: "st1",
    source_filename: "보고서.docx",
    submission_key: null,
    authenticity_status: "unverified",
    ...over,
  };
}

test("조립: 귀속 경로·식별값 출처가 서브행에 전달된다(배지 재료)", () => {
  const rows = assembleWorksheetRows({
    students: [student],
    submissions: [sub({ match_method: "auto_name", identity_source: "llm" })],
    scores: [],
    records: [],
  });
  assert.equal(rows[0].submissions[0].matchMethod, "auto_name");
  assert.equal(rows[0].submissions[0].identitySource, "llm");
});

test("조립: 매칭 필드를 안 넘긴 호출부도 그대로 동작한다(선택 필드 → null)", () => {
  const rows = assembleWorksheetRows({
    students: [student],
    submissions: [sub()],
    scores: [],
    records: [],
  });
  assert.equal(rows[0].submissions[0].matchMethod, null);
  assert.equal(rows[0].submissions[0].identitySource, null);
  assert.equal(rows[0].submissionCount, 1); // 기존 조립 결과는 불변
});

test("조립: 미귀속(student_id null) 제출물은 여전히 행에 들어가지 않는다", () => {
  const rows = assembleWorksheetRows({
    students: [student],
    submissions: [
      sub({ id: "sub1" }),
      sub({ id: "sub2", student_id: null }), // 배너로만 알 수 있는 제출물
    ],
    scores: [],
    records: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].submissionCount, 1);
  assert.deepEqual(
    rows[0].submissions.map((x) => x.id),
    ["sub1"],
  );
});
