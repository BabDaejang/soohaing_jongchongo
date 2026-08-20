import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDiscoveredIdentities,
  extractIdentityCandidatesFromFilename,
  verifyIdentityTokens,
  type DiscoveredIdentityRow,
  type StudentRef,
} from "@/lib/matching";

// 발견(discovery) 순수 함수 (리팩토링 4 배치 2, P-1).
// 핵심 방어선 두 가지를 여기서 검증한다:
//   ① 파일명·LLM에서 온 값은 **후보**일 뿐이고, 확정 불가면 포기한다(보수 원칙).
//   ② LLM이 만들어 낸 토큰은 문서에 실존할 때만 살아남는다(구조적 할루시네이션 차단).

// ── extractIdentityCandidatesFromFilename ────────────────────────────────
test("파일명: 5자리 학번 1개 + 한글 이름 토큰을 뽑는다", () => {
  const r = extractIdentityCandidatesFromFilename("2학년3반_10203_홍길동_수행평가최종.docx");
  assert.equal(r.no, "10203");
  assert.deepEqual(r.nameCandidates, ["홍길동"]);
});

test("파일명: 4~6자리 숫자가 2개면 학번을 포기한다(모호)", () => {
  const r = extractIdentityCandidatesFromFilename("10203_20304_홍길동.pdf");
  assert.equal(r.no, null);
  assert.deepEqual(r.nameCandidates, ["홍길동"]);
});

test("파일명: 7자리 숫자는 학번 후보가 아니다(4~6자리 밖)", () => {
  const r = extractIdentityCandidatesFromFilename("1234567_홍길동.pdf");
  assert.equal(r.no, null);
});

test("파일명: 상용어(수행평가·보고서·최종)는 이름 후보에서 제외된다", () => {
  const r = extractIdentityCandidatesFromFilename("홍길동_보고서_최종.docx");
  assert.deepEqual(r.nameCandidates, ["홍길동"]);
});

test("파일명: 식별 정보가 없으면 빈 결과 (SPEC 5.2의 '수행평가최종.docx' 예시)", () => {
  const r = extractIdentityCandidatesFromFilename("수행평가최종.docx");
  assert.equal(r.no, null);
  assert.deepEqual(r.nameCandidates, []);
});

test("파일명: 경로·확장자를 떼고 중복 토큰은 한 번만 센다", () => {
  const r = extractIdentityCandidatesFromFilename("과제/제출/10203 김민수 김민수.docx");
  assert.equal(r.no, "10203");
  assert.deepEqual(r.nameCandidates, ["김민수"]);
});

test("파일명: null·빈 문자열은 빈 결과", () => {
  assert.deepEqual(extractIdentityCandidatesFromFilename(null), {
    no: null,
    nameCandidates: [],
  });
});

// ── verifyIdentityTokens (실존 대조) ─────────────────────────────────────
test("실존 대조: 문서에 없는 학번은 버린다(환각 차단)", () => {
  const head = "학번 10203 이름 홍길동\n독서 감상문…";
  const r = verifyIdentityTokens(head, { no: "10204", name: "홍길동" });
  assert.equal(r.no, null); // 10204는 문서에 없다
  assert.equal(r.name, "홍길동");
});

test("실존 대조: 더 긴 숫자에 묻힌 학번은 토큰이 아니다(경계 규칙)", () => {
  const r = verifyIdentityTokens("제출번호 210203 입니다", { no: "10203", name: null });
  assert.equal(r.no, null);
});

test("실존 대조: 둘 다 문서에 있으면 둘 다 살린다", () => {
  const head = "1학년 10203 김민수";
  assert.deepEqual(verifyIdentityTokens(head, { no: "10203", name: "김민수" }), {
    no: "10203",
    name: "김민수",
  });
});

test("실존 대조: null 입력은 그대로 null", () => {
  assert.deepEqual(verifyIdentityTokens("아무 내용", { no: null, name: null }), {
    no: null,
    name: null,
  });
});

// ── aggregateDiscoveredIdentities ────────────────────────────────────────
function row(
  submissionId: string,
  no: string | null,
  name: string | null,
  source: DiscoveredIdentityRow["source"] = "llm",
): DiscoveredIdentityRow {
  return { submissionId, no, name, source };
}

test("집계: 같은 학번의 제출물이 한 후보로 묶이고 id가 모인다", () => {
  const out = aggregateDiscoveredIdentities(
    [row("s1", "10203", "홍길동"), row("s2", "10203", "홍길동")],
    [],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].no, "10203");
  assert.deepEqual(out[0].submissionIds, ["s1", "s2"]);
});

test("집계: 학번이 없으면 이름으로 묶는다", () => {
  const out = aggregateDiscoveredIdentities(
    [row("s1", null, "김민수"), row("s2", null, "김민수"), row("s3", null, "이서준")],
    [],
  );
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((d) => d.name).sort(),
    ["김민수", "이서준"],
  );
});

test("집계: 명단에 학번이 이미 있으면 후보에서 빠진다(매칭의 몫)", () => {
  const roster: StudentRef[] = [{ id: "a", student_number: "10203", name: "홍길동" }];
  const out = aggregateDiscoveredIdentities(
    [row("s1", "10203", "홍길동"), row("s2", "10204", "김민수")],
    roster,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].no, "10204");
});

test("집계: 명단에 이름이 이미 있으면(유일 일치) 후보에서 빠진다", () => {
  const roster: StudentRef[] = [{ id: "a", student_number: null, name: "홍길동" }];
  const out = aggregateDiscoveredIdentities([row("s1", null, "홍길동")], roster);
  assert.deepEqual(out, []);
});

test("집계: 명단에 동명이인이 있어도 후보로 만들지 않는다(중복 학생 방지)", () => {
  const roster: StudentRef[] = [
    { id: "a", student_number: "10101", name: "홍길동" },
    { id: "b", student_number: "20202", name: "홍길동" },
  ];
  const out = aggregateDiscoveredIdentities([row("s1", null, "홍길동")], roster);
  assert.deepEqual(out, []);
});

test("집계: 같은 학번에 다른 이름이 모이면 conflict로 표시하고 대표는 최다 등장", () => {
  const out = aggregateDiscoveredIdentities(
    [row("s1", "10203", "홍길동"), row("s2", "10203", "홍길동"), row("s3", "10203", "홍길순")],
    [],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "홍길동"); // 2회 > 1회
  assert.deepEqual(out[0].conflict, ["홍길동", "홍길순"]);
});

test("집계: 이름이 하나뿐이면 conflict는 빈 배열", () => {
  const out = aggregateDiscoveredIdentities([row("s1", "10203", "홍길동")], []);
  assert.deepEqual(out[0].conflict, []);
});

test("집계: 출처는 중복 없이 모인다", () => {
  const out = aggregateDiscoveredIdentities(
    [row("s1", "10203", "홍길동", "llm"), row("s2", "10203", "홍길동", "filename"), row("s3", "10203", null, "llm")],
    [],
  );
  assert.deepEqual([...out[0].sources].sort(), ["filename", "llm"]);
});

test("집계: 식별값이 하나도 없는 행은 무시한다", () => {
  const out = aggregateDiscoveredIdentities([row("s1", null, null)], []);
  assert.deepEqual(out, []);
});

test("집계: 학번 있는 후보가 먼저, 그다음 이름순으로 정렬된다", () => {
  const out = aggregateDiscoveredIdentities(
    [row("s1", null, "이서준"), row("s2", "10203", "홍길동"), row("s3", null, "강민")],
    [],
  );
  assert.deepEqual(
    out.map((d) => d.no ?? d.name),
    ["10203", "강민", "이서준"],
  );
});

test("집계: 이름 없는 학번-only 후보도 살아남는다(이름은 null)", () => {
  const out = aggregateDiscoveredIdentities([row("s1", "10203", null)], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, null);
});
