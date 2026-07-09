// 원본 자동 삭제 자격 판정 (순수 함수, SPEC 5.3 / INV-5). 단위 테스트 대상.
//
// INV-5: 교사의 추출 승인(extraction_approved_at) 이전에는 절대 삭제하지 않는다.
// 자동 삭제(N일) 배치도 이 조건을 우선한다 → 미승인이면 언제나 false.

export function isPurgeEligible(
  extractionApprovedAt: string | null,
  retentionDays: number | null,
  now: Date = new Date(),
): boolean {
  if (retentionDays == null) return false; // 자동 삭제 정책 꺼짐
  if (!extractionApprovedAt) return false; // 미승인 → 절대 삭제 금지 (INV-5)
  const approved = new Date(extractionApprovedAt);
  if (Number.isNaN(approved.getTime())) return false;
  const ageMs = now.getTime() - approved.getTime();
  return ageMs >= retentionDays * 24 * 60 * 60 * 1000;
}
