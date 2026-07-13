import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAladinSearch, parseAladinLookup } from "@/lib/factsheet/aladin";
import { parseNaverSearch } from "@/lib/factsheet/naver";
import { stripHtml, normalizeFetchUrl } from "@/lib/factsheet/fetch-page";

// ── 알라딘 검색 파서 ──────────────────────────────────────────────────

test("알라딘 검색: item 배열에서 후보를 뽑고 pubDate에서 연도만 추출한다", () => {
  const json = {
    item: [
      {
        title: "데미안",
        author: "헤르만 헤세",
        publisher: "민음사",
        pubDate: "2000-12-01",
        isbn13: "9788937460449",
        isbn: "8937460440",
        cover: "https://image.aladin.co.kr/cover/demian.jpg",
        link: "https://www.aladin.co.kr/shop/demian",
      },
    ],
  };
  assert.deepEqual(parseAladinSearch(json), [
    {
      isbn13: "9788937460449",
      title: "데미안",
      author: "헤르만 헤세",
      publisher: "민음사",
      pubYear: "2000",
      coverUrl: "https://image.aladin.co.kr/cover/demian.jpg",
      link: "https://www.aladin.co.kr/shop/demian",
    },
  ]);
});

test("알라딘 검색: isbn13이 없거나 형식이 다르면 isbn(13자리)로 폴백, 아니면 null", () => {
  const json = {
    item: [
      { title: "A", isbn: "9791234567890" }, // isbn13 없음 → isbn 폴백
      { title: "B", isbn: "8937460440" }, // 10자리 → null
      { title: "C", isbn13: "  " }, // 공백 → null
    ],
  };
  const out = parseAladinSearch(json);
  assert.equal(out[0].isbn13, "9791234567890");
  assert.equal(out[1].isbn13, null);
  assert.equal(out[2].isbn13, null);
});

test("알라딘 검색: title 없는 항목은 폐기, 예상 밖 응답은 빈 배열", () => {
  assert.deepEqual(parseAladinSearch({ item: [{ author: "무명" }] }), []);
  for (const bad of [null, undefined, 42, "x", [], {}, { item: "nope" }]) {
    assert.deepEqual(parseAladinSearch(bad), []);
  }
});

// ── 알라딘 상세 파서 ──────────────────────────────────────────────────

test("알라딘 상세: subInfo.toc·fullDescription의 HTML을 벗겨 저장한다", () => {
  const json = {
    item: [
      {
        title: "미움받을 용기",
        author: "기시미 이치로",
        publisher: "인플루엔셜",
        pubDate: "2014-11-17",
        isbn13: "9788996991342",
        cover: "https://image.aladin.co.kr/cover/courage.jpg",
        fullDescription: "<p>아들러 심리학을 <b>대화체</b>로 풀어낸 책.</p>",
        subInfo: { toc: "1장 트라우마를 부정하라<br>2장 모든 고민은 인간관계" },
      },
    ],
  };
  const detail = parseAladinLookup(json);
  assert.ok(detail);
  assert.equal(detail.isbn13, "9788996991342");
  assert.equal(detail.pubYear, "2014");
  assert.equal(detail.toc, "1장 트라우마를 부정하라 2장 모든 고민은 인간관계");
  assert.equal(detail.intro, "아들러 심리학을 대화체로 풀어낸 책.");
});

test("알라딘 상세: fullDescription 없으면 description으로 폴백, toc 없으면 null", () => {
  const json = {
    item: [{ title: "책", description: "간단한 소개" }],
  };
  const detail = parseAladinLookup(json);
  assert.ok(detail);
  assert.equal(detail.intro, "간단한 소개");
  assert.equal(detail.toc, null);
});

test("알라딘 상세: item이 비었거나 title 없으면 null", () => {
  assert.equal(parseAladinLookup({ item: [] }), null);
  assert.equal(parseAladinLookup({ item: [{ author: "무명" }] }), null);
  assert.equal(parseAladinLookup(null), null);
});

// ── 네이버 검색 파서 ──────────────────────────────────────────────────

test("네이버 검색: <b> 태그·엔티티를 벗기고 {title,url,snippet}로 변환한다", () => {
  const json = {
    items: [
      {
        title: "<b>데미안</b> 서평 &amp; 감상",
        link: "https://blog.naver.com/user/123",
        description: "새는 알을 깨고 <b>나온다</b>",
      },
    ],
  };
  assert.deepEqual(parseNaverSearch(json), [
    {
      title: "데미안 서평 & 감상",
      url: "https://blog.naver.com/user/123",
      snippet: "새는 알을 깨고 나온다",
    },
  ]);
});

test("네이버 검색: link 없으면 originallink 폴백, 둘 다 없으면 폐기", () => {
  const json = {
    items: [
      { title: "뉴스", originallink: "https://news.example.com/a", description: "본문" },
      { title: "링크없음", description: "폐기 대상" },
    ],
  };
  const out = parseNaverSearch(json);
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://news.example.com/a");
});

test("네이버 검색: 예상 밖 응답은 빈 배열", () => {
  for (const bad of [null, undefined, 42, "x", [], {}, { items: "nope" }]) {
    assert.deepEqual(parseNaverSearch(bad), []);
  }
});

// ── stripHtml (≥ 8건) ────────────────────────────────────────────────

test("stripHtml: script/style/noscript 블록을 통째로 제거한다", () => {
  const html =
    "<div>본문<script>var x=1;</script> 끝</div><style>.a{}</style><noscript>없음</noscript>";
  assert.equal(stripHtml(html), "본문 끝");
});

test("stripHtml: 태그를 벗기고 블록 종료 태그는 공백으로 바꾼다", () => {
  assert.equal(stripHtml("<p>가</p><p>나</p>"), "가 나");
  assert.equal(stripHtml("한<br>줄"), "한 줄");
  assert.equal(stripHtml("<li>항목1</li><li>항목2</li>"), "항목1 항목2");
});

test("stripHtml: 지정 엔티티를 치환한다", () => {
  assert.equal(
    stripHtml("A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39; F&nbsp;G"),
    'A & B <C> "D" \'E\' F G',
  );
});

test("stripHtml: 수치 엔티티를 코드포인트로 치환한다", () => {
  assert.equal(stripHtml("&#65;&#66;&#67;"), "ABC");
});

test("stripHtml: 연속 공백을 하나로 정규화하고 trim한다", () => {
  assert.equal(stripHtml("  가   나\n\t다  "), "가 나 다");
});

test("stripHtml: 빈 입력·태그만 있는 입력은 빈 문자열", () => {
  assert.equal(stripHtml(""), "");
  assert.equal(stripHtml("<div></div>"), "");
});

test("stripHtml: 잘못된 수치 엔티티는 공백으로 떨어진다", () => {
  assert.equal(stripHtml("A&#0;B"), "A B");
  assert.equal(stripHtml("A&#99999999;B"), "A B");
});

test("stripHtml: 태그가 없는 평문은 그대로(공백 정규화만)", () => {
  assert.equal(stripHtml("그냥 평문입니다"), "그냥 평문입니다");
});

// ── normalizeFetchUrl ────────────────────────────────────────────────

test("normalizeFetchUrl: 네이버 블로그 데스크톱 URL을 모바일 뷰로 치환한다", () => {
  assert.equal(
    normalizeFetchUrl("https://blog.naver.com/user/123"),
    "https://m.blog.naver.com/user/123",
  );
  // 다른 URL은 그대로
  assert.equal(
    normalizeFetchUrl("https://news.example.com/a"),
    "https://news.example.com/a",
  );
});
