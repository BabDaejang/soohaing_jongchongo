// 가성비(가격 대비 성능) 모델 추천 — 순수 함수(server-only 아님, 클라이언트에서도 사용).
// 저장된 모델 목록 중 우선순위가 높은 계열의 첫 후보를 추천한다(리팩토링 2 배치 7).

// 우선순위(위가 우선). model이 이 문자열로 시작(startsWith)하면 해당 계열로 본다.
const COST_EFFECTIVE_PRIORITY = [
  "gemini-2.5-flash",
  "gpt-4o-mini",
  "claude-haiku",
  "gemini-2.0-flash",
  "gpt-4o",
  "claude-sonnet",
];

export type ModelCandidate = {
  providerId: string;
  providerName: string;
  model: string;
};

// 우선순위 순회가 바깥 루프 — 더 저렴·빠른 계열을 먼저 고른다. 매칭 없으면 null.
export function recommendCostEffective(
  candidates: ModelCandidate[],
): ModelCandidate | null {
  for (const prefix of COST_EFFECTIVE_PRIORITY) {
    const hit = candidates.find((c) => c.model.startsWith(prefix));
    if (hit) return hit;
  }
  return null;
}
