import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTeacherScores } from "@/lib/scoring";
import { assembleWorksheetRows, type SubmissionRaw } from "@/lib/worksheet/assemble";
import type { RubricCriterion } from "@/lib/supabase/types";

// 평가 리뷰·수정 (리팩토링 4 배치 4, P-3).
// ① 교사 입력은 조용히 보정하지 않고 **거부**한다(저장한 값과 남는 값이 달라지면 안 된다).
// ② 작업결과표 서브행이 기준별 결과를 들고 있어야 화면에서 확인·수정할 수 있다.

const criteria: RubricCriterion[] = [
  { id: "c1", name: "내용 이해", description: "", max_score: 10, weight: 1 },
  { id: "c2", name: "표현", description: "", max_score: 5, weight: 1 },
];

// ── validateTeacherScores: 거부 규칙 ─────────────────────────────────────
test("검증: 정상 입력은 루브릭 순서로 정규화된다", () => {
  const r = validateTeacherScores(
    [
      { criterion_id: "c2", score: 3 },
      { criterion_id: "c1", score: 9 },
    ],
    criteria,
  );
  assert.ok(r.ok);
  assert.deepEqual(r.scores, [
    { criterion_id: "c1", score: 9 },
    { criterion_id: "c2", score: 3 },
  ]);
});

test("검증: 루브릭에 없는 기준은 거부한다(유령 점수 방지)", () => {
  const r = validateTeacherScores(
    [
      { criterion_id: "c1", score: 5 },
      { criterion_id: "c2", score: 5 },
      { criterion_id: "삭제된기준", score: 5 },
    ],
    criteria,
  );
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /루브릭에 없는 기준/);
});

test("검증: 만점 초과는 클램프가 아니라 거부한다", () => {
  const r = validateTeacherScores(
    [
      { criterion_id: "c1", score: 11 }, // max 10
      { criterion_id: "c2", score: 3 },
    ],
    criteria,
  );
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /0~10 범위/);
});

test("검증: 음수·소수는 거부한다", () => {
  const neg = validateTeacherScores(
    [
      { criterion_id: "c1", score: -1 },
      { criterion_id: "c2", score: 1 },
    ],
    criteria,
  );
  assert.equal(neg.ok, false);

  const frac = validateTeacherScores(
    [
      { criterion_id: "c1", score: 1.5 },
      { criterion_id: "c2", score: 1 },
    ],
    criteria,
  );
  assert.equal(frac.ok, false);
  assert.match(frac.ok === false ? frac.error : "", /정수/);
});

test("검증: 기준이 빠지거나 중복되면 거부한다", () => {
  const missing = validateTeacherScores([{ criterion_id: "c1", score: 5 }], criteria);
  assert.equal(missing.ok, false);
  assert.match(missing.ok === false ? missing.error : "", /빠진 기준/);

  const dup = validateTeacherScores(
    [
      { criterion_id: "c1", score: 5 },
      { criterion_id: "c1", score: 6 },
      { criterion_id: "c2", score: 1 },
    ],
    criteria,
  );
  assert.equal(dup.ok, false);
  assert.match(dup.ok === false ? dup.error : "", /중복/);
});

test("검증: 루브릭이 비어 있으면 거부한다", () => {
  const r = validateTeacherScores([{ criterion_id: "c1", score: 1 }], []);
  assert.equal(r.ok, false);
});

// ── assemble: 서브행 평가 조립 ───────────────────────────────────────────
const student = {
  id: "st1",
  student_number: "10203",
  name: "홍길동",
  teacher_memo: null,
  score_override: null,
  override_reason: null,
};

const sub: SubmissionRaw = {
  id: "sub1",
  student_id: "st1",
  source_filename: "보고서.docx",
  submission_key: null,
  authenticity_status: "unverified",
};

test("조립: 기준별 점수·근거·합계·origin이 서브행에 실린다", () => {
  const rows = assembleWorksheetRows({
    students: [student],
    submissions: [sub],
    scores: [],
    records: [],
    evaluations: [
      {
        submission_id: "sub1",
        total_score: 12,
        origin: "teacher",
        scores: [
          { criterion_id: "c1", score: 9, evidence_quote: "근거 문장" },
          { criterion_id: "c2", score: 3, evidence_quote: "" },
        ],
      },
    ],
    criteria,
  });
  const ev = rows[0].submissions[0].evaluation;
  assert.ok(ev);
  assert.equal(ev.total, 12);
  assert.equal(ev.origin, "teacher");
  assert.deepEqual(ev.scores, [
    { criterionId: "c1", name: "내용 이해", score: 9, max: 10, evidence: "근거 문장" },
    { criterionId: "c2", name: "표현", score: 3, max: 5, evidence: "" },
  ]);
});

test("조립: 평가가 없는 제출물은 evaluation이 null(미채점 표시)", () => {
  const rows = assembleWorksheetRows({
    students: [student],
    submissions: [sub],
    scores: [],
    records: [],
    evaluations: [],
    criteria,
  });
  assert.equal(rows[0].submissions[0].evaluation, null);
});

test("조립: 기준 목록은 루브릭 순서를 따르고 빠진 기준은 0점으로 채운다", () => {
  const rows = assembleWorksheetRows({
    students: [student],
    submissions: [sub],
    scores: [],
    records: [],
    evaluations: [
      {
        submission_id: "sub1",
        total_score: 4,
        origin: "llm",
        // 루브릭에서 사라진 기준 + c1 누락
        scores: [
          { criterion_id: "옛기준", score: 7, evidence_quote: "무시됨" },
          { criterion_id: "c2", score: 4, evidence_quote: "" },
        ],
      },
    ],
    criteria,
  });
  const ev = rows[0].submissions[0].evaluation;
  assert.ok(ev);
  assert.deepEqual(
    ev.scores.map((s) => [s.criterionId, s.score]),
    [
      ["c1", 0],
      ["c2", 4],
    ],
  );
  assert.equal(ev.total, 4, "합계는 저장된 total_score를 그대로 쓴다");
});

test("조립: evaluations를 넘기지 않는 호출부도 그대로 동작한다(하위 호환)", () => {
  const rows = assembleWorksheetRows({
    students: [student],
    submissions: [sub],
    scores: [],
    records: [],
  });
  assert.equal(rows[0].submissions[0].evaluation, null);
  assert.equal(rows[0].submissionCount, 1);
});
