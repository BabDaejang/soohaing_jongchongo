// 검증 패스 결과 파싱 (SPEC 7.3). **순수 함수** — 검증 LLM의 JSON 응답을 안전하게 정규화한다.
// 보수적 원칙(할루시네이션 금지): 근거로 제시된 제출물 id 중 실제 컨텍스트에 없는 것은 제거하고,
// 유효 근거(제출물 id 또는 교사 메모)가 하나도 없으면 grounded=false로 강등한다.
import type { VerificationSentence } from "@/lib/supabase/types";

// LLM 응답 텍스트에서 JSON 배열을 추출해 문장별 근거 판정으로 정규화한다.
//   validSubmissionIds: 생성 컨텍스트에 포함된 제출물 id 집합(근거 후보).
export function parseVerification(
  text: string,
  validSubmissionIds: string[],
): VerificationSentence[] {
  const valid = new Set(validSubmissionIds);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: VerificationSentence[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const sentence = typeof rec.sentence === "string" ? rec.sentence.trim() : "";
    if (!sentence) continue;

    // 근거 제출물 id: 배열 문자열만, 컨텍스트에 실제 존재하는 것만(환각 차단).
    const rawIds = Array.isArray(rec.source_submission_ids)
      ? rec.source_submission_ids
      : [];
    const sourceIds = rawIds.filter(
      (v): v is string => typeof v === "string" && valid.has(v),
    );
    const byMemo = rec.grounded_by_memo === true;

    // 모델이 grounded=true라 해도 유효 근거(제출물 id 또는 교사 메모)가 없으면 강등.
    const claimed = rec.grounded === true;
    const grounded = claimed && (sourceIds.length > 0 || byMemo);

    result.push({
      sentence,
      grounded,
      source_submission_ids: sourceIds,
      ...(byMemo ? { grounded_by_memo: true } : {}),
    });
  }
  return result;
}

// unsupported(근거 없는) 문장 수 — UI 요약·감사용.
export function countUnsupported(verification: VerificationSentence[]): number {
  return verification.filter((v) => !v.grounded).length;
}
