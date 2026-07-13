import "server-only";
import { stripHtml } from "./fetch-page";

// 네이버 검색 API — 블로그·뉴스·책 URL 수집 (리팩토링 2 배치 8).
// 여기서 얻은 url은 fetchPageText(배치 9·10)로 원문을 가져와 대조에 쓴다.
// 서버 전용 — client id/secret이 요청 헤더에 실린다(INV-4와 동일 취급).

const BASE = "https://openapi.naver.com/v1/search";
const TIMEOUT_MS = 12_000;

export type NaverKind = "blog" | "news" | "book";
export type NaverResult = { title: string; url: string; snippet: string };

// ── 순수 함수 (fixture 단위 테스트 대상) ─────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(rec: Record<string, unknown> | null, field: string): string {
  const v = rec?.[field];
  // 네이버는 검색어를 <b>…</b>로 강조하고 엔티티를 인코딩한다 — 태그·엔티티를 벗긴다.
  return typeof v === "string" ? stripHtml(v) : "";
}

function urlOf(rec: Record<string, unknown> | null): string {
  const link = rec?.link;
  if (typeof link === "string" && link.length > 0) return link;
  const orig = rec?.originallink; // news 폴백
  return typeof orig === "string" ? orig : "";
}

// 검색 응답 → {title, url, snippet}. url 없는 항목은 대조에 못 쓰므로 폐기한다.
export function parseNaverSearch(json: unknown): NaverResult[] {
  const items = asRecord(json)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((row) => {
    const rec = asRecord(row);
    const url = urlOf(rec);
    const title = text(rec, "title");
    if (!url || !title) return [];
    return { title, url, snippet: text(rec, "description") };
  });
}

// ── 조회 ──────────────────────────────────────────────────────────────

function requireKeys(): { id: string; secret: string } {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "네이버 검색 키(NAVER_CLIENT_ID/SECRET)가 설정되지 않았습니다 — 관리자가 등록해야 자동 수집이 동작합니다.",
    );
  }
  return { id, secret };
}

export async function searchNaver(
  kind: NaverKind,
  query: string,
): Promise<NaverResult[]> {
  const q = query.trim();
  if (!q) return [];
  const { id, secret } = requireKeys();
  const url = new URL(`${BASE}/${kind}.json`);
  url.searchParams.set("query", q);
  url.searchParams.set("display", "10");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("네이버 API 호출에 실패했습니다 (네트워크 오류·시간 초과).");
  }
  if (!res.ok) {
    throw new Error(`네이버 API 호출 실패 (HTTP ${res.status}).`);
  }
  return parseNaverSearch(await res.json());
}

export function hasNaverKeys(): boolean {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}
