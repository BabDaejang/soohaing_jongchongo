import "server-only";
import { stripHtml } from "./fetch-page";

// 알라딘 OpenAPI — 도서 메타·목차·소개 확정 (리팩토링 2 배치 8).
// 메타(목차·소개)는 LLM 비경유로 원본을 그대로 저장한다(무할루시네이션 원칙).
// 서버 전용 — ttbkey가 URL 쿼리에 실리므로 클라이언트 유입은 INV-4와 동일 취급.

const SEARCH_URL = "http://www.aladin.co.kr/ttb/api/ItemSearch.aspx";
const LOOKUP_URL = "http://www.aladin.co.kr/ttb/api/ItemLookUp.aspx";
const TIMEOUT_MS = 12_000;

export type BookCandidate = {
  isbn13: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  pubYear: string | null;
  coverUrl: string | null;
  link: string | null;
};

export type BookDetail = {
  isbn13: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  pubYear: string | null;
  coverUrl: string | null;
  toc: string | null; // 목차 원본(HTML 제거)
  intro: string | null; // 책 소개 원본(HTML 제거)
};

// ── 순수 함수 (fixture 단위 테스트 대상) ─────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(rec: Record<string, unknown> | null, field: string): string | null {
  const v = rec?.[field];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function isbn13Of(rec: Record<string, unknown> | null): string | null {
  const i13 = str(rec, "isbn13");
  if (i13 && /^\d{13}$/.test(i13)) return i13;
  const i = str(rec, "isbn");
  return i && /^\d{13}$/.test(i) ? i : null;
}

// pubDate "2020-05-15" → "2020". 4자리 연도만 안전하게 뽑는다.
function pubYearOf(rec: Record<string, unknown> | null): string | null {
  const d = str(rec, "pubDate");
  const m = d?.match(/(\d{4})/);
  return m ? m[1] : null;
}

function candidateFrom(rec: Record<string, unknown> | null): BookCandidate | null {
  const title = str(rec, "title");
  if (!title) return null;
  return {
    isbn13: isbn13Of(rec),
    title,
    author: str(rec, "author"),
    publisher: str(rec, "publisher"),
    pubYear: pubYearOf(rec),
    coverUrl: str(rec, "cover"),
    link: str(rec, "link"),
  };
}

// ItemSearch 응답 → 후보 목록. 형식 불량 항목은 조용히 폐기한다.
export function parseAladinSearch(json: unknown): BookCandidate[] {
  const items = asRecord(json)?.item;
  if (!Array.isArray(items)) return [];
  return items.flatMap((row) => candidateFrom(asRecord(row)) ?? []);
}

// ItemLookUp(OptResult=Toc,fulldescription) 응답 → 상세.
// toc는 subInfo.toc, intro는 item.fullDescription(없으면 description)에서 — HTML을 벗겨 저장한다.
export function parseAladinLookup(json: unknown): BookDetail | null {
  const items = asRecord(json)?.item;
  const rec = Array.isArray(items) ? asRecord(items[0]) : null;
  const title = str(rec, "title");
  if (!rec || !title) return null;

  const sub = asRecord(rec.subInfo);
  const tocRaw = str(sub, "toc");
  const introRaw = str(rec, "fullDescription") ?? str(rec, "description");

  return {
    isbn13: isbn13Of(rec),
    title,
    author: str(rec, "author"),
    publisher: str(rec, "publisher"),
    pubYear: pubYearOf(rec),
    coverUrl: str(rec, "cover"),
    toc: tocRaw ? stripHtml(tocRaw) : null,
    intro: introRaw ? stripHtml(introRaw) : null,
  };
}

// ── 조회 ──────────────────────────────────────────────────────────────

function requireKey(): string {
  const key = process.env.ALADIN_TTB_KEY;
  if (!key) {
    throw new Error(
      "알라딘 검색 키(ALADIN_TTB_KEY)가 설정되지 않았습니다 — 관리자가 등록해야 도서 검색이 동작합니다.",
    );
  }
  return key;
}

async function fetchAladin(url: URL): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // url에는 ttbkey 쿼리가 들어 있으므로 메시지에 절대 넣지 않는다.
    throw new Error("알라딘 API 호출에 실패했습니다 (네트워크 오류·시간 초과).");
  }
  if (!res.ok) {
    const err = new Error(`알라딘 API 호출 실패 (HTTP ${res.status}).`);
    Object.defineProperty(err, "status", { value: res.status, enumerable: true });
    throw err;
  }
  // output=js는 JSON을 주지만 content-type이 text/javascript인 경우가 있어 직접 파싱한다.
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("알라딘 응답을 해석하지 못했습니다.");
  }
}

export async function searchBooks(query: string): Promise<BookCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const key = requireKey();
  const url = new URL(SEARCH_URL);
  url.searchParams.set("ttbkey", key);
  url.searchParams.set("Query", q);
  url.searchParams.set("QueryType", "Keyword");
  url.searchParams.set("MaxResults", "10");
  url.searchParams.set("start", "1");
  url.searchParams.set("SearchTarget", "Book");
  url.searchParams.set("output", "js");
  url.searchParams.set("Version", "20131101");
  return parseAladinSearch(await fetchAladin(url));
}

export async function lookupBook(isbn13: string): Promise<BookDetail | null> {
  const id = isbn13.trim();
  if (!/^\d{13}$/.test(id)) {
    throw new Error("올바른 ISBN13이 아닙니다.");
  }
  const key = requireKey();
  const url = new URL(LOOKUP_URL);
  url.searchParams.set("ttbkey", key);
  url.searchParams.set("ItemId", id);
  url.searchParams.set("ItemIdType", "ISBN13");
  url.searchParams.set("output", "js");
  url.searchParams.set("Version", "20131101");
  url.searchParams.set("OptResult", "Toc,fulldescription");
  return parseAladinLookup(await fetchAladin(url));
}

export function hasAladinKey(): boolean {
  return Boolean(process.env.ALADIN_TTB_KEY);
}
