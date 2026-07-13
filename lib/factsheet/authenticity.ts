// 진실성 검증(페이즈 2 채점 앞 스테이지)의 대조 순수 로직 (리팩토링 2 배치 10).
// server-only가 아니다 — 단위 테스트에서 fetch·DB 없이 그대로 부른다.
//
// 무할루시네이션·혼입 방지 원칙과 정합: parseFindings가 검증 패스(parseVerification)와 같은 방식으로
// LLM이 지어낸 증거 id를 제거하고, 근거 없는 supported/contradicted 판정을 not_found로 강등한다.
// 판정은 플래그(상태·근거)만 만든다 — 자동 감점·채점 제외는 여기서도, 소비부에서도 하지 않는다.

export type SourceClaim = {
  kind: "book" | "article" | "paper" | "webpage" | "none";
  title: string | null;
  author: string | null;
  publisher: string | null;
  year: string | null;
};

export type Finding = {
  claim: string;
  verdict: "supported" | "contradicted" | "not_found";
  entry_id: string | null; // 근거가 팩트시트 entry면 그 id, 아니면 null
  url: string | null; // 근거가 인용 URL 원문이면 그 URL, 아니면 null
  quote: string;
};

const SOURCE_KINDS: ReadonlySet<SourceClaim["kind"]> = new Set([
  "book",
  "article",
  "paper",
  "webpage",
  "none",
]);
const VERDICTS: ReadonlySet<Finding["verdict"]> = new Set([
  "supported",
  "contradicted",
  "not_found",
]);
const MAX_URLS = 5;
const IDENTIFY_MAX = 3000; // 식별 프롬프트에 넣는 제출물 앞부분
const COMPARE_SUBMISSION_MAX = 6000; // 대조 프롬프트의 제출물 절단

// ── URL 추출 (LLM 비경유 · 정규식) ────────────────────────────────────

// 제출물 본문에서 http(s) URL을 뽑아 중복 제거 후 최대 5개. 꼬리 문장부호는 떼어낸다.
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'()]+/gi) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?)\]}'"]+$/, ""); // 문장 끝 구두점 제거
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

// ── 출처 식별 ──────────────────────────────────────────────────────────

// 제출물 앞 3000자에서 인용 출처(SourceClaim) 1개를 뽑는 프롬프트.
export function buildIdentifyPrompt(content: string): string {
  return [
    "아래 [제출물]에서 학생이 인용·참고한 **출처**를 식별하라(하나만, 가장 핵심적인 것).",
    "- 책이면 kind=\"book\", 제목·저자·출판사·출간연도를 아는 만큼 채운다.",
    "- 신문/웹 기사면 kind=\"article\", 일반 웹페이지면 kind=\"webpage\".",
    "- 논문이면 kind=\"paper\"(제목·저자를 채운다).",
    "- 외부 출처를 인용·참고하지 않았으면 kind=\"none\".",
    "확인되지 않는 값은 지어내지 말고 null로 둔다.",
    'JSON 객체 하나만 반환: {"kind":"book|article|paper|webpage|none","title":null,"author":null,"publisher":null,"year":null}',
    "",
    "[제출물]",
    content.slice(0, IDENTIFY_MAX),
  ].join("\n");
}

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

function strOrNull(rec: Record<string, unknown>, field: string): string | null {
  const v = rec[field];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// 식별 응답 파싱(관용적: 코드펜스·전후 텍스트 허용). 형식 불량이면 kind="none".
export function parseSourceClaim(text: string): SourceClaim {
  const rec = objMatch(text);
  const none: SourceClaim = {
    kind: "none",
    title: null,
    author: null,
    publisher: null,
    year: null,
  };
  if (!rec) return none;
  const rawKind = typeof rec.kind === "string" ? rec.kind.trim() : "none";
  const kind = SOURCE_KINDS.has(rawKind as SourceClaim["kind"])
    ? (rawKind as SourceClaim["kind"])
    : "none";
  return {
    kind,
    title: strOrNull(rec, "title"),
    author: strOrNull(rec, "author"),
    publisher: strOrNull(rec, "publisher"),
    year: strOrNull(rec, "year"),
  };
}

// ── 대조 ──────────────────────────────────────────────────────────────

// 제출물이 출처에 대해 주장하는 내용을 뽑아 각 주장을 [증거]와 대조하는 프롬프트.
// evidence.id는 팩트시트 entry uuid, 인용 URL 원문이면 그 URL, 팩트시트 메타면 "meta".
export function buildComparePrompt(
  submission: string,
  evidence: { id: string; label: string; text: string }[],
): string {
  const evidenceBlock = evidence
    .map((e) => `[증거 id:${e.id} · ${e.label}]\n${e.text}`)
    .join("\n\n");
  return [
    "학생 [제출물]이 인용한 출처에 대해 **주장하는 내용**을 항목으로 뽑아, 각 주장을 아래 [증거]와 대조하라.",
    "- 증거가 주장을 뒷받침하면 verdict=\"supported\", evidence_id에 그 증거 id, quote에 근거가 된 증거 원문을 인용.",
    "- 증거가 주장과 모순되면 verdict=\"contradicted\", 모순되는 증거 id·인용.",
    "- 어느 증거에서도 확인되지 않으면 verdict=\"not_found\", evidence_id는 \"\".",
    "[증거]에 없는 id를 지어내지 마라. 주장이 없으면 빈 배열 [].",
    'JSON 배열만 반환: [{"claim":"...","verdict":"supported|contradicted|not_found","evidence_id":"<증거 id 또는 빈 문자열>","quote":"<증거 원문 인용>"}]',
    "",
    "[제출물]",
    submission.slice(0, COMPARE_SUBMISSION_MAX),
    "",
    "[증거]",
    evidenceBlock || "(증거 없음)",
  ].join("\n");
}

// 대조 응답 파싱. 검증 패스 패턴: 증거 id가 실제 제시분(validEvidenceIds)에 없으면 제거하고,
// 근거 없는 supported/contradicted는 not_found로 강등한다(할루시네이션 차단).
export function parseFindings(
  text: string,
  validEvidenceIds: Set<string>,
): Finding[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Finding[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const claim = typeof rec.claim === "string" ? rec.claim.trim() : "";
    if (!claim) continue;

    const rawVerdict =
      typeof rec.verdict === "string" ? rec.verdict.trim() : "not_found";
    let verdict: Finding["verdict"] = VERDICTS.has(
      rawVerdict as Finding["verdict"],
    )
      ? (rawVerdict as Finding["verdict"])
      : "not_found";

    const eid = typeof rec.evidence_id === "string" ? rec.evidence_id.trim() : "";
    const quote = typeof rec.quote === "string" ? rec.quote.trim() : "";
    const valid = eid.length > 0 && validEvidenceIds.has(eid);

    // 근거 id가 환각이면 supported/contradicted를 not_found로 강등(근거 없는 판정 방지).
    if (!valid && verdict !== "not_found") verdict = "not_found";

    let entry_id: string | null = null;
    let url: string | null = null;
    if (valid) {
      if (/^https?:\/\//i.test(eid)) url = eid;
      else if (eid !== "meta") entry_id = eid;
    }

    out.push({ claim, verdict, entry_id, url, quote });
  }
  return out;
}

// findings → 제출물 진실성 상태.
//   모순 ≥ 1 → suspect / 주장 ≥ 1이고 supported 비율 ≥ 0.5이며 모순 0 → verified / 그 외 → unverifiable.
export function summarizeVerdict(
  findings: Finding[],
): "verified" | "suspect" | "unverifiable" {
  if (findings.length === 0) return "unverifiable";
  const contradicted = findings.filter((f) => f.verdict === "contradicted").length;
  if (contradicted >= 1) return "suspect";
  const supported = findings.filter((f) => f.verdict === "supported").length;
  if (supported / findings.length >= 0.5) return "verified";
  return "unverifiable";
}
