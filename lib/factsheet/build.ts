import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeText, sha256Hex } from "@/lib/parsing";
import { callLLM, type ModelTarget } from "@/lib/llm";
import { searchNaver, type NaverKind } from "./naver";
import { fetchPageText } from "./fetch-page";
import {
  buildEntryExtractionPrompt,
  buildSearchQueries,
  filterBySnippetMatch,
  parseEntrySuggestions,
} from "./extract";
import type { FactsheetSourceType } from "@/lib/supabase/types";

// 팩트시트 자동 수집 파이프라인 (리팩토링 2 배치 9). 서버 전용.
//   planCollection    — 검색으로 수집 대상 URL 목록을 조립(중복·기존 제외, 최대 8건)
//   collectOneSource  — URL 1건: fetch → 추출(LLM) → 스니펫 대조 → 중복 제외 후 entry insert
// 무할루시네이션 원칙: LLM은 추출만, filterBySnippetMatch가 원문 실존을 강제한다(배치 9 extract.ts).
// insert는 owner 클라이언트(RLS can_edit_factsheet가 소유·비shared·승인을 강제 — admin 미사용).

const MAX_TARGETS = 8; // 실행당 수집 대상 문서 상한
const MAX_ENTRIES_PER_RUN = 30; // 문서 1건에서 저장하는 entry 상한(초과분 폐기)
const EXTRACT_SOURCE_MAX = 12000; // LLM 프롬프트·대조에 쓰는 원문 절단 상한(토큰 방어)

export type CollectTarget = {
  url: string;
  sourceType: "naver_book" | "naver_blog" | "naver_news" | "web";
  label: string;
};

// 어떤 네이버 채널을 어떤 쿼리로 뒤질지(결정적). buildSearchQueries 순서에 기대지 않고
// 채널별 성격에 맞는 쿼리를 고정 배치한다.
function collectionSlots(book: {
  title: string;
  author: string | null;
}): { kind: NaverKind; query: string; sourceType: CollectTarget["sourceType"]; label: string }[] {
  const q = buildSearchQueries(book); // [목차, 리뷰, 챕터 요약, 서평, 줄거리]
  const bookQuery = book.author ? `${book.title} ${book.author}` : book.title;
  return [
    { kind: "blog", query: q[1], sourceType: "naver_blog", label: "네이버 블로그" }, // 리뷰
    { kind: "blog", query: q[4], sourceType: "naver_blog", label: "네이버 블로그" }, // 줄거리
    { kind: "book", query: bookQuery, sourceType: "naver_book", label: "네이버 책" },
    { kind: "news", query: book.title, sourceType: "naver_news", label: "네이버 뉴스" },
  ];
}

// 검색으로 수집 대상 URL 목록을 조립한다(중복 URL·기존 entry의 source_url 제외, 최대 8건).
// 채널 하나의 검색이 실패해도(키·네트워크) 그 채널만 건너뛰고 나머지를 모은다.
export async function planCollection(
  book: { title: string; author: string | null },
  excludeUrls: string[],
): Promise<CollectTarget[]> {
  const seen = new Set(excludeUrls);
  const targets: CollectTarget[] = [];

  for (const slot of collectionSlots(book)) {
    if (targets.length >= MAX_TARGETS) break;
    let results: { title: string; url: string; snippet: string }[];
    try {
      results = await searchNaver(slot.kind, slot.query);
    } catch {
      continue; // 이 채널만 스킵(키 미설정·호출 실패)
    }
    for (const r of results) {
      if (targets.length >= MAX_TARGETS) break;
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      targets.push({
        url: r.url,
        sourceType: slot.sourceType,
        label: `${slot.label} · ${r.title}`.slice(0, 120),
      });
    }
  }
  return targets;
}

// 첫 항목 라벨 + 개수로 간결한 로그를 만든다("『3장』 외 2건 추가").
function addedMessage(labels: string[], truncated: boolean): string {
  const n = labels.length;
  const head = `『${labels[0]}』`;
  const base = n === 1 ? `${head} 추가` : `${head} 외 ${n - 1}건 추가`;
  return truncated ? `${base} (상한 ${MAX_ENTRIES_PER_RUN} 초과분 폐기)` : base;
}

// 수집 대상 1건 처리. throw하지 않고 {ok, message, added}로 돌려준다(터미널 로그용).
export async function collectOneSource(
  userId: string,
  factsheetId: string,
  target: CollectTarget,
  llmTarget: ModelTarget,
): Promise<{ ok: boolean; message: string; added: number }> {
  const supabase = await createClient();

  // 사전 상태 확인: shared는 어떤 경로로도 보강 불가(RLS도 막지만 명확한 메시지를 준다).
  const { data: fs, error: fsErr } = await supabase
    .from("factsheets")
    .select("share_status, title, author")
    .eq("id", factsheetId)
    .maybeSingle();
  if (fsErr) {
    return { ok: false, message: fsErr.message.slice(0, 300), added: 0 };
  }
  if (!fs) {
    return { ok: false, message: "팩트시트를 찾을 수 없습니다.", added: 0 };
  }
  if (fs.share_status === "shared") {
    return {
      ok: false,
      message: "공유 팩트시트는 보강할 수 없습니다 — 복제 후 보강하세요.",
      added: 0,
    };
  }

  // 원문 확보(같은 텍스트로 프롬프트·대조 — 절단 경계 밖 인용의 오탐 방지).
  let sourceText: string;
  try {
    sourceText = (await fetchPageText(target.url)).slice(0, EXTRACT_SOURCE_MAX);
  } catch (e) {
    return {
      ok: false,
      message: (e instanceof Error ? e.message : "원문 수집 실패").slice(0, 300),
      added: 0,
    };
  }
  if (!sourceText.trim()) {
    return { ok: true, message: "새 내용 없음", added: 0 };
  }

  // 기존 챕터(우선순위 프롬프트)·기존 해시(중복 제외) 조회.
  const { data: existing } = await supabase
    .from("factsheet_entries")
    .select("chapter_label, content_hash")
    .eq("factsheet_id", factsheetId);
  const existingChapters = Array.from(
    new Set((existing ?? []).map((e) => e.chapter_label)),
  );
  const seenHash = new Set((existing ?? []).map((e) => e.content_hash));

  // 추출(LLM은 추출만) → 파싱 → 스니펫 대조(할루시네이션 구조 차단).
  let extracted: string;
  try {
    const res = await callLLM({
      userId,
      purpose: "추출",
      overrideTarget: llmTarget, // 프로젝트 라우팅 밖 — 호출부가 정한 추출 모델
      temperature: 0,
      messages: [
        {
          role: "user",
          content: buildEntryExtractionPrompt(
            { title: fs.title, author: fs.author },
            sourceText,
            existingChapters,
          ),
        },
      ],
    });
    extracted = res.text;
  } catch (e) {
    return {
      ok: false,
      message: (e instanceof Error ? e.message : "추출 호출 실패").slice(0, 300),
      added: 0,
    };
  }

  const verified = filterBySnippetMatch(
    parseEntrySuggestions(extracted),
    sourceText,
  );
  if (verified.length === 0) {
    return { ok: true, message: "새 내용 없음", added: 0 };
  }

  // content_hash로 기존·이번 배치 내 중복을 제외하고 상한까지 담는다.
  const sourceType: FactsheetSourceType = target.sourceType;
  const rows: {
    factsheet_id: string;
    owner_id: string;
    chapter_label: string;
    content: string;
    quote: string;
    source_url: string;
    source_type: FactsheetSourceType;
    content_hash: string;
  }[] = [];
  let truncated = false;
  for (const s of verified) {
    if (rows.length >= MAX_ENTRIES_PER_RUN) {
      truncated = true;
      break;
    }
    const hash = sha256Hex(normalizeText(s.content));
    if (seenHash.has(hash)) continue;
    seenHash.add(hash);
    rows.push({
      factsheet_id: factsheetId,
      owner_id: userId,
      chapter_label: s.chapter_label,
      content: s.content,
      quote: s.quote,
      source_url: target.url,
      source_type: sourceType,
      content_hash: hash,
    });
  }
  if (rows.length === 0) {
    return { ok: true, message: "새 내용 없음", added: 0 };
  }

  const { error } = await supabase.from("factsheet_entries").insert(rows); // RLS: can_edit_factsheet
  if (error) {
    const msg = /duplicate key|content_hash/.test(error.message)
      ? "같은 내용의 항목이 이미 있습니다."
      : error.message;
    return { ok: false, message: msg.slice(0, 300), added: 0 };
  }
  return {
    ok: true,
    message: addedMessage(
      rows.map((r) => r.chapter_label),
      truncated,
    ),
    added: rows.length,
  };
}
