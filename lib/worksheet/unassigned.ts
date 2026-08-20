// 미귀속(=학생이 정해지지 않은) 제출물 카운트 — 순수 계산 (리팩토링 4 배치 3, P-2).
//
// 작업결과표는 학생 행 기준이라 `student_id IS NULL`인 제출물이 **표에 아예 나타나지 않는다**.
// 그대로 두면 "파일을 올렸는데 아무 데도 없다"가 되므로 배너로 존재를 알리고 해소 동선을 준다.
// 카운트 조립은 순수 함수로 떼어 단위 테스트한다(표시 문구가 0건일 때 새지 않도록).

export type UnassignedCount = {
  unmatched: number; // match_status='unmatched'
  pending: number; // match_status in ('pending_confirm','update_pending')
};

export const EMPTY_UNASSIGNED: UnassignedCount = { unmatched: 0, pending: 0 };

// 음수·비유한값은 0으로 본다(서버 count가 null일 때의 방어).
function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function unassignedTotal(c: UnassignedCount): number {
  return safe(c.unmatched) + safe(c.pending);
}

// 배너 세부 문구: "미매칭 3건 · 확인 대기 2건". 0인 갈래는 아예 쓰지 않는다.
export function unassignedSummary(c: UnassignedCount): string {
  const parts: string[] = [];
  if (safe(c.unmatched) > 0) parts.push(`미매칭 ${safe(c.unmatched)}건`);
  if (safe(c.pending) > 0) parts.push(`확인 대기 ${safe(c.pending)}건`);
  return parts.join(" · ");
}
