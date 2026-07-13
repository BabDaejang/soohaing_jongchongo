// 팩트시트 자동 수집의 추출·검증 순수 로직 (리팩토링 2 배치 9).
// server-only가 아니다 — 단위 테스트에서 fetch·DB 없이 그대로 부른다.
//
// 무할루시네이션 원칙(공통 프롬프트): LLM이 반환한 챕터 항목은 그 근거 스니펫(quote)이
// 수집 원문에 실제로 존재하는 것만 저장한다. 프롬프트는 방어선 1(생성 금지 지시),
// filterBySnippetMatch가 방어선 2(서버 문자열 대조로 강제) — LLM 내부 지식으로 만든
// 항목은 quote가 원문에 없으므로 구조적으로 폐기된다.

export type EntrySuggestion = {
  chapter_label: string;
  content: string;
  quote: string;
};

const QUOTE_MIN = 12; // 이보다 짧은 인용은 우연 일치 위험이 커 폐기(구조적 강제)

// 대조용 정규화: 개행 포함 모든 공백 연속을 단일 공백으로 압축하고 trim한다.
// 원문·인용을 같은 규칙으로 정규화해 마크업 제거·줄바꿈 차이를 흡수한 뒤 부분일치를 본다.
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// 수집 문서 1건에서 챕터별 사실을 뽑는 프롬프트(전체 user 메시지 문자열).
// sourceText는 호출부가 이미 상한 절단한 것을 받는다(대조도 같은 텍스트로 하도록).
export function buildEntryExtractionPrompt(
  book: { title: string; author: string | null },
  sourceText: string,
  existingChapters: string[],
): string {
  const author = book.author ?? "저자 미상";
  const existing =
    existingChapters.length > 0 ? existingChapters.join(", ") : "(없음)";
  return [
    `아래 [수집 문서]는 도서 『${book.title}』(${author})에 관한 웹 문서다.`,
    "문서에 **명시된** 이 책의 장(챕터)별·페이지별 내용 사실만 추출하라.",
    "각 항목에 근거가 된 문서 원문을 quote로 **그대로 복사**하라(다듬기 금지 — 원문과 글자가 다르면 폐기된다).",
    "책 내용이 아닌 감상·광고·다른 책 이야기는 제외.",
    `이미 확보한 챕터(${existing})보다 **다른 장의 새 내용을 우선**하라.`,
    'JSON 배열만 반환: [{"chapter_label":"3장","content":"...","quote":"..."}]',
    "문서에 책 내용이 없으면 [].",
    "",
    "[수집 문서]",
    sourceText,
  ].join("\n");
}

// 응답 JSON 배열 파싱(관용적: 코드펜스·전후 텍스트 허용, 형식 불량 항목 폐기).
export function parseEntrySuggestions(text: string): EntrySuggestion[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: EntrySuggestion[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const content = typeof rec.content === "string" ? rec.content.trim() : "";
    const quote = typeof rec.quote === "string" ? rec.quote.trim() : "";
    // content가 없으면 사실 항목이 아니다. quote는 filter에서 최종 검증하되,
    // 여기서도 문자열이 아니면 빈 값으로 두어 filter가 폐기하게 한다.
    if (!content) continue;
    const label =
      typeof rec.chapter_label === "string" && rec.chapter_label.trim()
        ? rec.chapter_label.trim()
        : "전체";
    out.push({ chapter_label: label, content, quote });
  }
  return out;
}

// 할루시네이션 구조 차단(핵심): quote를 정규화해 sourceText(동일 정규화)에 부분 문자열로
// 실존하는 항목만 통과시킨다. quote가 QUOTE_MIN자 미만이거나 없으면 폐기.
export function filterBySnippetMatch(
  suggestions: EntrySuggestion[],
  sourceText: string,
): EntrySuggestion[] {
  const haystack = normalizeForMatch(sourceText);
  return suggestions.filter((s) => {
    const needle = normalizeForMatch(s.quote);
    if (needle.length < QUOTE_MIN) return false;
    return haystack.includes(needle);
  });
}

// 검색 쿼리 조합(결정적). 저자 미상이면 서평 쿼리에서 저자 자리를 빼 중복 공백을 만들지 않는다.
export function buildSearchQueries(book: {
  title: string;
  author: string | null;
}): string[] {
  const { title, author } = book;
  return [
    `${title} 목차`,
    `${title} 리뷰`,
    `${title} 챕터 요약`,
    author ? `${title} ${author} 서평` : `${title} 서평`,
    `${title} 줄거리`,
  ];
}
