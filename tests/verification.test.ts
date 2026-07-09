import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVerification,
  countUnsupported,
} from "@/lib/records/verification";

const VALID = ["sub-1", "sub-2"];

test("근거 없는 문장을 unsupported로 플래그(수용 3)", () => {
  const output = `설명 텍스트...
[
  {"sentence":"동기가 뚜렷함.","grounded":true,"source_submission_ids":["sub-1"]},
  {"sentence":"성찰이 깊음.","grounded":false,"source_submission_ids":[]}
]`;
  const v = parseVerification(output, VALID);
  assert.equal(v.length, 2);
  assert.equal(v[0].grounded, true);
  assert.deepEqual(v[0].source_submission_ids, ["sub-1"]);
  assert.equal(v[1].grounded, false); // 근거 없는 문장
  assert.equal(countUnsupported(v), 1);
});

test("컨텍스트에 없는 제출물 id(환각)는 제거되고 grounded 강등", () => {
  const output = `[
  {"sentence":"전국 1등을 함.","grounded":true,"source_submission_ids":["sub-999"]}
]`;
  const v = parseVerification(output, VALID);
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].source_submission_ids, []); // 명단 밖 id 제거
  assert.equal(v[0].grounded, false); // 유효 근거 없음 → 강등
});

test("교사 메모 근거는 grounded 유지(source는 비어도 됨)", () => {
  const output = `[
  {"sentence":"성실히 참여함.","grounded":true,"source_submission_ids":[],"grounded_by_memo":true}
]`;
  const v = parseVerification(output, VALID);
  assert.equal(v[0].grounded, true);
  assert.equal(v[0].grounded_by_memo, true);
});

test("JSON이 없거나 깨지면 빈 배열", () => {
  assert.deepEqual(parseVerification("응답 없음", VALID), []);
  assert.deepEqual(parseVerification("[깨진 json", VALID), []);
});
