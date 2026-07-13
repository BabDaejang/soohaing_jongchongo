import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseEntrySuggestions,
  filterBySnippetMatch,
  buildSearchQueries,
  buildEntryExtractionPrompt,
  type EntrySuggestion,
} from "@/lib/factsheet/extract";

// ── parseEntrySuggestions (관용 파싱·불량 폐기) ────────────────────────

test("parse: 순수 JSON 배열을 항목으로 파싱한다", () => {
  const text =
    '[{"chapter_label":"3장","content":"주인공이 알을 깨고 나온다","quote":"새는 알에서 나오려고 투쟁한다"}]';
  assert.deepEqual(parseEntrySuggestions(text), [
    {
      chapter_label: "3장",
      content: "주인공이 알을 깨고 나온다",
      quote: "새는 알에서 나오려고 투쟁한다",
    },
  ]);
});

test("parse: 코드펜스·전후 텍스트가 있어도 배열만 뽑아낸다", () => {
  const text =
    "분석 결과입니다:\n```json\n[{\"chapter_label\":\"1장\",\"content\":\"도입부\",\"quote\":\"이 책은 성장의 기록이다\"}]\n```\n이상입니다.";
  assert.deepEqual(parseEntrySuggestions(text), [
    { chapter_label: "1장", content: "도입부", quote: "이 책은 성장의 기록이다" },
  ]);
});

test("parse: 형식 불량 항목(객체 아님·content 없음)은 폐기하고 유효분만 남긴다", () => {
  const text = JSON.stringify([
    "문자열항목",
    { chapter_label: "2장", quote: "내용 없는 항목" }, // content 없음 → 폐기
    { content: "라벨 없는 항목", quote: "라벨이 없어도 전체로" },
    null,
  ]);
  const out = parseEntrySuggestions(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, "라벨 없는 항목");
  assert.equal(out[0].chapter_label, "전체"); // 라벨 없으면 '전체'
});

test("parse: 빈 배열·비JSON은 빈 배열", () => {
  assert.deepEqual(parseEntrySuggestions("[]"), []);
  assert.deepEqual(parseEntrySuggestions("죄송하지만 책 내용을 찾지 못했습니다."), []);
  assert.deepEqual(parseEntrySuggestions("[불완전한 배열"), []);
});

test("parse: chapter_label이 문자열이 아니면 '전체'로 대체한다", () => {
  const text = JSON.stringify([
    { chapter_label: 3, content: "숫자 라벨", quote: "이 문장은 원문에 있다고 치자" },
  ]);
  const out = parseEntrySuggestions(text);
  assert.equal(out[0].chapter_label, "전체");
});

// ── filterBySnippetMatch (할루시네이션 구조 차단) ──────────────────────

const SOURCE =
  "이 책은 데미안이라는 인물을 통해 성장을 이야기한다. 새는 알에서 나오려고 투쟁한다. 알은 세계다.";

test("filter: quote가 원문에 그대로 있으면 통과", () => {
  const s: EntrySuggestion[] = [
    { chapter_label: "3장", content: "성장 서사", quote: "새는 알에서 나오려고 투쟁한다" },
  ];
  assert.deepEqual(filterBySnippetMatch(s, SOURCE), s);
});

test("filter: quote가 원문에 없으면(할루시네이션) 폐기", () => {
  const s: EntrySuggestion[] = [
    { chapter_label: "3장", content: "지어낸 내용", quote: "이 문장은 원문 어디에도 존재하지 않는다" },
  ];
  assert.deepEqual(filterBySnippetMatch(s, SOURCE), []);
});

test("filter: quote가 12자 미만이면 폐기(우연 일치 방지)", () => {
  const s: EntrySuggestion[] = [
    { chapter_label: "1장", content: "짧은 인용", quote: "알은 세계다" }, // 원문에 있으나 12자 미만
  ];
  assert.deepEqual(filterBySnippetMatch(s, SOURCE), []);
});

test("filter: 공백·줄바꿈 차이는 정규화로 흡수해 통과시킨다", () => {
  const source = "새는   알에서\n나오려고\t투쟁한다 그리고 계속된다";
  const s: EntrySuggestion[] = [
    { chapter_label: "3장", content: "정규화", quote: "새는 알에서 나오려고 투쟁한다" },
  ];
  assert.equal(filterBySnippetMatch(s, source).length, 1);
});

test("filter: quote가 비어 있으면(content만 있음) 폐기", () => {
  const s: EntrySuggestion[] = [
    { chapter_label: "3장", content: "근거 없는 사실 서술", quote: "" },
  ];
  assert.deepEqual(filterBySnippetMatch(s, SOURCE), []);
});

// ── buildSearchQueries (결정성) ───────────────────────────────────────

test("buildSearchQueries: 5개 쿼리를 결정적으로 조립한다", () => {
  const a = buildSearchQueries({ title: "데미안", author: "헤르만 헤세" });
  const b = buildSearchQueries({ title: "데미안", author: "헤르만 헤세" });
  assert.deepEqual(a, b); // 결정성
  assert.deepEqual(a, [
    "데미안 목차",
    "데미안 리뷰",
    "데미안 챕터 요약",
    "데미안 헤르만 헤세 서평",
    "데미안 줄거리",
  ]);
});

test("buildSearchQueries: 저자 미상이면 서평 쿼리에서 저자 자리를 뺀다(중복 공백 없음)", () => {
  const q = buildSearchQueries({ title: "코스모스", author: null });
  assert.equal(q[3], "코스모스 서평");
  assert.ok(q.every((s) => !s.includes("  "))); // 연속 공백 없음
});

// ── buildEntryExtractionPrompt (스모크) ───────────────────────────────

test("buildEntryExtractionPrompt: 제목·저자·기존 챕터·원문을 포함한다", () => {
  const p = buildEntryExtractionPrompt(
    { title: "데미안", author: "헤르만 헤세" },
    "여기 원문 텍스트",
    ["1장", "2장"],
  );
  assert.ok(p.includes("데미안"));
  assert.ok(p.includes("헤르만 헤세"));
  assert.ok(p.includes("1장, 2장"));
  assert.ok(p.includes("여기 원문 텍스트"));
});
