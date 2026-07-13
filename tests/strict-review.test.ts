import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseStrictVerdict,
  metaAgrees,
  buildStrictReviewPrompt,
} from "@/lib/factsheet/strict-review";

// ── parseStrictVerdict ────────────────────────────────────────────────

test("parseStrictVerdict: pass=true를 통과로 읽고 reason을 채운다", () => {
  const v = parseStrictVerdict('{"pass": true, "reason": "원문과 일치"}');
  assert.equal(v.pass, true);
  assert.equal(v.reason, "원문과 일치");
});

test("parseStrictVerdict: 코드펜스·전후 텍스트를 허용한다", () => {
  const text = "결과입니다:\n```json\n{\"pass\": false, \"reason\": \"과장됨\"}\n```\n끝.";
  const v = parseStrictVerdict(text);
  assert.equal(v.pass, false);
  assert.equal(v.reason, "과장됨");
});

test("parseStrictVerdict: pass가 boolean true가 아니면 fail로 강등한다", () => {
  assert.equal(parseStrictVerdict('{"pass": "true"}').pass, false); // 문자열은 통과 아님
  assert.equal(parseStrictVerdict('{"pass": 1}').pass, false);
  assert.equal(parseStrictVerdict('{"reason": "판단 보류"}').pass, false);
});

test("parseStrictVerdict: 해석 불가면 fail + 안내 사유", () => {
  const v = parseStrictVerdict("도무지 알 수 없는 응답");
  assert.equal(v.pass, false);
  assert.equal(v.reason, "검증 응답을 해석하지 못했습니다.");
});

test("parseStrictVerdict: reason이 없으면 pass 여부에 맞는 기본 사유", () => {
  assert.equal(parseStrictVerdict('{"pass": true}').reason, "원문·발췌에 의해 뒷받침됨");
  assert.equal(parseStrictVerdict('{"pass": false}').reason, "근거 불충분");
});

// ── metaAgrees ────────────────────────────────────────────────────────

test("metaAgrees: 공백·대소문자 무시 부분 포함으로 제목이 일치한다", () => {
  const r = metaAgrees(
    { title: "데미안", author: "헤르만 헤세" },
    { title: "데미안 (세계문학전집)", author: "헤르만 헤세" },
  );
  assert.equal(r.title, true);
  assert.equal(r.author, true);
});

test("metaAgrees: 제목이 전혀 다르면 불일치", () => {
  const r = metaAgrees(
    { title: "데미안", author: "헤세" },
    { title: "수레바퀴 아래서", author: "헤세" },
  );
  assert.equal(r.title, false);
});

test("metaAgrees: 저자가 한쪽이라도 null이면 저자 비교는 생략(true)", () => {
  const r = metaAgrees(
    { title: "데미안", author: null },
    { title: "데미안", author: "헤세" },
  );
  assert.equal(r.title, true);
  assert.equal(r.author, true);
});

test("metaAgrees: 저자가 둘 다 있으나 다르면 불일치", () => {
  const r = metaAgrees(
    { title: "데미안", author: "김철수" },
    { title: "데미안", author: "헤르만 헤세" },
  );
  assert.equal(r.author, false);
});

// ── buildStrictReviewPrompt ───────────────────────────────────────────

test("buildStrictReviewPrompt: 항목 내용·발췌·원문을 모두 담고 JSON 반환을 지시한다", () => {
  const p = buildStrictReviewPrompt(
    { content: "3장은 성장을 다룬다.", quote: "성장을 다룬다" },
    "이 책의 3장은 성장을 다룬다.",
  );
  assert.match(p, /항목 내용/);
  assert.match(p, /발췌/);
  assert.match(p, /원문/);
  assert.match(p, /"pass"/);
});

test("buildStrictReviewPrompt: 발췌가 없으면 (없음)으로 표기한다", () => {
  const p = buildStrictReviewPrompt({ content: "내용", quote: null }, "원문 텍스트");
  assert.match(p, /\(없음\)/);
});
