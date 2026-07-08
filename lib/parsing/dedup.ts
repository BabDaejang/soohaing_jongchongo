// 재업로드 중복·변경 감지 결정 (순수 함수, SPEC 5.1). 단위 테스트 대상.
// 자동 덮어쓰기 금지: 내용이 바뀌면 기존 행을 update_pending으로 표시하고
// 새 내용은 pending_content에 보관한다(교사 승인은 세션 6).

export type DedupExisting = { id: string; content_hash: string } | null;

export type DedupDecision =
  | { action: "insert" } // 신규 제출물 → 삽입
  | { action: "skip"; id: string } // 동일 내용 → 건너뜀
  | { action: "update_pending"; id: string }; // 내용 변경 → 갱신 확인 대기

export function decideDedup(
  existing: DedupExisting,
  nextHash: string,
): DedupDecision {
  if (!existing) return { action: "insert" };
  if (existing.content_hash === nextHash) return { action: "skip", id: existing.id };
  return { action: "update_pending", id: existing.id };
}
