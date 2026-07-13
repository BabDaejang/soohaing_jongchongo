import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractUrls,
  parseSourceClaim,
  buildIdentifyPrompt,
  buildComparePrompt,
  parseFindings,
  summarizeVerdict,
  type Finding,
} from "@/lib/factsheet/authenticity";

// ── extractUrls ───────────────────────────────────────────────────────

test("extractUrls: http(s) URL을 뽑고 꼬리 구두점을 제거한다", () => {
  const text =
    "출처는 https://example.com/article 이고, 참고: (http://news.co.kr/1). 끝.";
  assert.deepEqual(extractUrls(text), [
    "https://example.com/article",
    "http://news.co.kr/1",
  ]);
});

test("extractUrls: 중복을 제거하고 최대 5개까지만 반환한다", () => {
  const text = [
    "https://a.com https://a.com",
    "https://b.com https://c.com https://d.com https://e.com https://f.com https://g.com",
  ].join(" ");
  const urls = extractUrls(text);
  assert.equal(urls.length, 5);
  assert.deepEqual(urls, [
    "https://a.com",
    "https://b.com",
    "https://c.com",
    "https://d.com",
    "https://e.com",
  ]);
});

test("extractUrls: URL이 없으면 빈 배열", () => {
  assert.deepEqual(extractUrls("URL 없는 제출물입니다."), []);
});

// ── parseSourceClaim ──────────────────────────────────────────────────

test("parseSourceClaim: 도서 주장을 파싱한다", () => {
  const text =
    '{"kind":"book","title":"코스모스","author":"칼 세이건","publisher":"사이언스북스","year":"2004"}';
  assert.deepEqual(parseSourceClaim(text), {
    kind: "book",
    title: "코스모스",
    author: "칼 세이건",
    publisher: "사이언스북스",
    year: "2004",
  });
});

test("parseSourceClaim: 코드펜스·전후 텍스트가 있어도 객체만 뽑는다", () => {
  const text = "분석:\n```json\n{\"kind\":\"webpage\",\"title\":\"기사 제목\"}\n```\n끝";
  const claim = parseSourceClaim(text);
  assert.equal(claim.kind, "webpage");
  assert.equal(claim.title, "기사 제목");
  assert.equal(claim.author, null);
});

test("parseSourceClaim: 불량·알 수 없는 kind는 none으로 정규화", () => {
  assert.equal(parseSourceClaim("그냥 텍스트").kind, "none");
  assert.equal(parseSourceClaim('{"kind":"video","title":"x"}').kind, "none");
});

test("buildIdentifyPrompt: 제출물 앞부분과 지시가 담긴다", () => {
  const prompt = buildIdentifyPrompt("학생 글 " + "가".repeat(5000));
  assert.match(prompt, /식별하라/);
  assert.match(prompt, /\[제출물\]/);
  // 앞 3000자만 담는다(전체 5000+자를 넣지 않는다).
  assert.ok(prompt.length < 4000);
});

// ── parseFindings (환각 evidence id 제거) ──────────────────────────────

test("parseFindings: 유효 entry id는 entry_id로, URL은 url로 채운다", () => {
  const valid = new Set(["entry-1", "https://src.com/a", "meta"]);
  const text = JSON.stringify([
    { claim: "A", verdict: "supported", evidence_id: "entry-1", quote: "근거1" },
    { claim: "B", verdict: "supported", evidence_id: "https://src.com/a", quote: "근거2" },
    { claim: "C", verdict: "contradicted", evidence_id: "meta", quote: "근거3" },
  ]);
  const findings = parseFindings(text, valid);
  assert.equal(findings.length, 3);
  assert.deepEqual(
    { entry_id: findings[0].entry_id, url: findings[0].url },
    { entry_id: "entry-1", url: null },
  );
  assert.deepEqual(
    { entry_id: findings[1].entry_id, url: findings[1].url },
    { entry_id: null, url: "https://src.com/a" },
  );
  // meta는 유효 근거지만 entry도 url도 아니다(둘 다 null, verdict 유지).
  assert.deepEqual(
    { entry_id: findings[2].entry_id, url: findings[2].url, verdict: findings[2].verdict },
    { entry_id: null, url: null, verdict: "contradicted" },
  );
});

test("parseFindings: 환각 id의 supported는 not_found로 강등하고 id를 버린다", () => {
  const valid = new Set(["entry-1"]);
  const text = JSON.stringify([
    { claim: "A", verdict: "supported", evidence_id: "지어낸-id", quote: "x" },
  ]);
  const findings = parseFindings(text, valid);
  assert.equal(findings[0].verdict, "not_found");
  assert.equal(findings[0].entry_id, null);
  assert.equal(findings[0].url, null);
});

test("parseFindings: not_found·evidence_id 빈 값은 그대로 통과", () => {
  const findings = parseFindings(
    JSON.stringify([{ claim: "A", verdict: "not_found", evidence_id: "", quote: "" }]),
    new Set<string>(),
  );
  assert.deepEqual(findings, [
    { claim: "A", verdict: "not_found", entry_id: null, url: null, quote: "" },
  ]);
});

test("parseFindings: claim 없는 항목·불량 verdict를 방어한다", () => {
  const valid = new Set(["e1"]);
  const text = JSON.stringify([
    { verdict: "supported", evidence_id: "e1" }, // claim 없음 → 폐기
    { claim: "B", verdict: "xxx", evidence_id: "e1", quote: "q" }, // 불량 verdict → not_found
  ]);
  const findings = parseFindings(text, valid);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].claim, "B");
  assert.equal(findings[0].verdict, "not_found");
});

test("parseFindings: 배열이 아니면 빈 배열", () => {
  assert.deepEqual(parseFindings("응답 없음", new Set()), []);
  assert.deepEqual(parseFindings('{"claim":"A"}', new Set()), []);
});

test("buildComparePrompt: 증거 id·라벨·본문이 담긴다", () => {
  const prompt = buildComparePrompt("제출물 본문", [
    { id: "meta", label: "도서 메타", text: "목차: 1장 2장" },
    { id: "https://x.com", label: "인용 URL", text: "기사 원문" },
  ]);
  assert.match(prompt, /증거 id:meta · 도서 메타/);
  assert.match(prompt, /증거 id:https:\/\/x\.com · 인용 URL/);
  assert.match(prompt, /제출물 본문/);
});

// ── summarizeVerdict (경계) ────────────────────────────────────────────

function f(verdict: Finding["verdict"]): Finding {
  return { claim: "c", verdict, entry_id: null, url: null, quote: "" };
}

test("summarizeVerdict: 모순 1건이면 supported가 많아도 suspect", () => {
  assert.equal(
    summarizeVerdict([f("supported"), f("supported"), f("contradicted")]),
    "suspect",
  );
});

test("summarizeVerdict: 모순 0·supported 비율 ≥ 0.5면 verified", () => {
  assert.equal(summarizeVerdict([f("supported"), f("not_found")]), "verified");
  assert.equal(summarizeVerdict([f("supported")]), "verified");
});

test("summarizeVerdict: supported 비율 < 0.5면 unverifiable", () => {
  assert.equal(
    summarizeVerdict([f("supported"), f("not_found"), f("not_found")]),
    "unverifiable",
  );
});

test("summarizeVerdict: 주장이 없으면 unverifiable", () => {
  assert.equal(summarizeVerdict([]), "unverifiable");
});
