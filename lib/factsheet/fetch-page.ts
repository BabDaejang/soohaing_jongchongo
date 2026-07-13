import "server-only";

// URL 인용(기사·웹페이지·블로그) 원문을 가져와 텍스트만 남긴다 (리팩토링 2 배치 8).
// 진실성 검증(배치 10)과 팩트시트 자동 수집(배치 9)의 대조 원문 소스.
// 서버 전용 — 임의 URL을 fetch하므로 클라이언트에서 직접 부르지 않는다.

const MAX_BYTES = 2 * 1024 * 1024; // 2MB 상한(초과 절단)
const TIMEOUT_MS = 10_000;

// ── 순수 함수 (단위 테스트 대상) ──────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

// HTML → 평문. script/style/noscript 블록을 통째로 제거한 뒤 태그를 벗기고,
// 몇 종의 엔티티를 치환하고 공백을 정규화한다. 부분일치 대조(배치 9)를 위해
// 원문 어휘는 보존하되 마크업만 걷어낸다.
export function stripHtml(html: string): string {
  if (!html) return "";
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    // 블록/개행 경계 태그만 공백으로 바꿔 단어가 붙지 않게 한다.
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th)[^>]*>/gi, " ")
    // 나머지(인라인 <b>·<span>·<a> 등)는 공백 없이 제거 — 한글 단어가 갈라지지 않게 한다.
    .replace(/<[^>]*>/g, "");
  for (const [ent, ch] of Object.entries(ENTITIES)) {
    text = text.split(ent).join(ch);
  }
  // 남은 수치 엔티티(&#123; / &#xABC;)는 안전 범위만 치환한다.
  text = text.replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)));
  return text.replace(/\s+/g, " ").trim();
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

// 네이버 블로그는 iframe 구조라 데스크톱 URL로는 본문이 오지 않는다 — 모바일 뷰로 치환한다.
export function normalizeFetchUrl(url: string): string {
  return url.replace(
    /^https?:\/\/blog\.naver\.com\//i,
    "https://m.blog.naver.com/",
  );
}

// ── fetch ────────────────────────────────────────────────────────────

// content-type이 text/html·text/plain일 때만 텍스트를 반환한다. 실패·비텍스트는 throw.
export async function fetchPageText(url: string): Promise<string> {
  const target = normalizeFetchUrl(url);
  let res: Response;
  try {
    res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      headers: {
        // 일부 사이트가 기본 UA를 막으므로 일반 브라우저 UA를 보낸다.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,text/plain",
      },
    });
  } catch {
    throw new Error("원문을 가져오지 못했습니다 (네트워크 오류·시간 초과).");
  }
  if (!res.ok) {
    throw new Error(`원문을 가져오지 못했습니다 (HTTP ${res.status}).`);
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("텍스트 문서가 아니어서 대조할 수 없습니다.");
  }

  const buf = await res.arrayBuffer();
  const bytes =
    buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return contentType.includes("text/plain")
    ? raw.replace(/\s+/g, " ").trim()
    : stripHtml(raw);
}
