import "server-only";

import { callLLM, type ModelTarget } from "@/lib/llm";
import { fetchPageText } from "./fetch-page";
import { filterBySnippetMatch } from "./extract";
import { lookupBook } from "./aladin";
import type { FactsheetEntry } from "@/lib/supabase/types";

// 관리자 승인 전 AI 엄격 자동 검증 (리팩토링 2 배치 11). 서버 전용.
//   reviewEntryStrict — entry 1건: 출처 재fetch → 발췌 실존 결정적 대조(배치 9 filter) → LLM 뒷받침 판정
//   reviewMetaStrict  — 팩트시트 단위(finalize 1회): lookupBook 재조회로 제목·저자 일치 확인
// 무할루시네이션 원칙과 정합: 결정적 대조(스니펫 실존)가 선행 방어선, LLM은 내용 뒷받침만 판정한다.
// 판정은 리포트(참고 자료)일 뿐 — 승인/반려는 관리자가 결정한다(자동 승인·반려 없음).

const REVIEW_SOURCE_MAX = 12000; // 재수집 원문 절단(LLM 프롬프트·대조에 같은 텍스트)
const REVIEW_CONTENT_MAX = 2000; // 프롬프트에 넣는 항목 내용 절단

// 검증 대상 entry의 최소 필드(actions가 전체 행을 넘겨도 무방).
export type ReviewableEntry = Pick<
  FactsheetEntry,
  "id" | "chapter_label" | "content" | "quote" | "source_url"
>;

export type EntryReview = {
  entryId: string;
  result: "pass" | "fail" | "unfetchable";
  note: string;
};

export type MetaReview = {
  status: "ok" | "warn" | "skipped";
  note: string;
};

// ── 순수 함수 (단위 테스트 대상) ──────────────────────────────────────

export type StrictVerdict = { pass: boolean; reason: string };

function objMatch(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed: unknown = JSON.parse(m[0]);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// LLM 판정 파싱(관용적: 코드펜스·전후 텍스트 허용). pass는 boolean true일 때만 통과로 본다
// (엄격 원칙 — 애매하거나 해석 불가면 fail로 강등해 관리자 육안 검토를 유도한다).
export function parseStrictVerdict(text: string): StrictVerdict {
  const rec = objMatch(text);
  if (!rec) return { pass: false, reason: "검증 응답을 해석하지 못했습니다." };
  const pass = rec.pass === true;
  const reason =
    typeof rec.reason === "string" && rec.reason.trim()
      ? rec.reason.trim()
      : pass
        ? "원문·발췌에 의해 뒷받침됨"
        : "근거 불충분";
  return { pass, reason };
}

// entry 1건 검증 프롬프트. 오직 제시된 [원문]·[발췌]만 근거로 삼도록 지시한다(내부 지식 금지).
export function buildStrictReviewPrompt(
  entry: { content: string; quote: string | null },
  sourceText: string,
): string {
  return [
    "아래 [원문]과 [발췌]만을 근거로 [항목 내용]이 정확한지 **엄격하게** 검증하라.",
    "- [항목 내용]이 [원문]·[발췌]에 의해 정확히 뒷받침되면 pass=true.",
    "- 과장·왜곡되었거나 원문에 없는 사실이 섞였으면 pass=false, 사유를 reason에 적는다.",
    "원문에 없는 지식으로 보완·추측하지 마라 — 제시된 [원문]·[발췌]만 근거로 삼는다.",
    'JSON 객체 하나만 반환: {"pass": true|false, "reason": "..."}',
    "",
    "[항목 내용]",
    entry.content.slice(0, REVIEW_CONTENT_MAX),
    "",
    "[발췌]",
    entry.quote ?? "(없음)",
    "",
    "[원문]",
    sourceText,
  ].join("\n");
}

function normLoose(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

// 제목·저자 느슨 일치(공백 제거·대소문자 무시·부분 포함 양방향). 저자가 한쪽이라도 null이면 저자는 비교 생략(true).
export function metaAgrees(
  expected: { title: string; author: string | null },
  found: { title: string; author: string | null },
): { title: boolean; author: boolean } {
  const et = normLoose(expected.title);
  const ft = normLoose(found.title);
  const title = et.length > 0 && ft.length > 0 && (et.includes(ft) || ft.includes(et));
  let author = true;
  if (expected.author && found.author) {
    const ea = normLoose(expected.author);
    const fa = normLoose(found.author);
    author = ea.includes(fa) || fa.includes(ea);
  }
  return { title, author };
}

// ── 검증 실행 (서버) ──────────────────────────────────────────────────

// entry 1건. throw하지 않고 EntryReview로 돌려준다(터미널 로그·리포트용).
export async function reviewEntryStrict(
  entry: ReviewableEntry,
  llmTarget: ModelTarget,
  adminUserId: string,
): Promise<EntryReview> {
  const url = entry.source_url?.trim();
  // 출처 URL이 없으면(user_upload/user_manual) 자동 재확인 불가 — 관리자 육안 판단.
  if (!url) {
    return {
      entryId: entry.id,
      result: "unfetchable",
      note: "출처 재확인 불가 — 관리자 육안 판단 필요",
    };
  }

  // 원문 재수집(같은 텍스트로 대조·프롬프트 — 절단 경계 밖 인용의 오탐 방지).
  let sourceText: string;
  try {
    sourceText = (await fetchPageText(url)).slice(0, REVIEW_SOURCE_MAX);
  } catch (e) {
    return {
      entryId: entry.id,
      result: "unfetchable",
      note: `원문 재수집 실패: ${e instanceof Error ? e.message : "오류"}`.slice(0, 300),
    };
  }
  if (!sourceText.trim()) {
    return { entryId: entry.id, result: "unfetchable", note: "원문이 비어 있어 재확인 불가" };
  }

  // ① 결정적 대조: 발췌(quote)가 원문에 실존하는가(배치 9 filterBySnippetMatch 재사용).
  const matched = filterBySnippetMatch(
    [{ chapter_label: entry.chapter_label, content: entry.content, quote: entry.quote ?? "" }],
    sourceText,
  );
  if (matched.length === 0) {
    return { entryId: entry.id, result: "fail", note: "스니펫이 출처 원문에 없음" };
  }

  // ② LLM 판정: 내용이 원문·발췌에 의해 정확히 뒷받침되는가.
  try {
    const res = await callLLM({
      userId: adminUserId, // 관리자 자신의 키 해석(개인 키 우선, 없으면 기본 키)
      purpose: "검증",
      overrideTarget: llmTarget,
      temperature: 0,
      messages: [
        { role: "user", content: buildStrictReviewPrompt(entry, sourceText) },
      ],
    });
    const verdict = parseStrictVerdict(res.text);
    return {
      entryId: entry.id,
      result: verdict.pass ? "pass" : "fail",
      note: verdict.reason,
    };
  } catch (e) {
    // LLM 실패는 확정 fail이 아니라 재확인 불가(관리자 판단 유도).
    return {
      entryId: entry.id,
      result: "unfetchable",
      note: `검증 호출 실패: ${e instanceof Error ? e.message : "오류"}`.slice(0, 300),
    };
  }
}

// 팩트시트 메타 재확인(finalize에서 1회). LLM 비경유 — 알라딘 재조회로 제목·저자 일치만 본다.
export async function reviewMetaStrict(factsheet: {
  isbn13: string | null;
  title: string;
  author: string | null;
}): Promise<MetaReview> {
  if (!factsheet.isbn13) {
    return { status: "skipped", note: "ISBN 없음 — 메타 재확인 불가" };
  }
  let detail;
  try {
    detail = await lookupBook(factsheet.isbn13);
  } catch (e) {
    // 알라딘 키 미설정·조회 실패는 경고가 아니라 생략(기능 비활성이지 오류 아님).
    return {
      status: "skipped",
      note: `메타 재확인 생략: ${e instanceof Error ? e.message : "조회 실패"}`.slice(0, 200),
    };
  }
  if (!detail) {
    return { status: "warn", note: "알라딘에서 해당 ISBN 도서를 찾지 못했습니다." };
  }
  const agree = metaAgrees(
    { title: factsheet.title, author: factsheet.author },
    { title: detail.title, author: detail.author },
  );
  if (!agree.title) {
    return { status: "warn", note: `제목 불일치 — 알라딘: 『${detail.title}』` };
  }
  if (!agree.author) {
    return { status: "warn", note: `저자 불일치 — 알라딘: ${detail.author ?? "미상"}` };
  }
  return { status: "ok", note: "제목·저자 일치" };
}
