// 작업결과표 갱신 이벤트(클라이언트 유틸) — 배치 간 고정 계약.
// 다른 화면·액션이 행을 바꾼 뒤 emitWorksheetRefresh()를 호출하면, 화면에 떠 있는
// 작업결과표가 (디바운스 후) fetchWorksheetRows로 스스로 다시 읽는다.

export const WORKSHEET_REFRESH_EVENT = "worksheet:refresh";

export function emitWorksheetRefresh(): void {
  if (typeof window === "undefined") return; // SSR 가드
  window.dispatchEvent(new CustomEvent(WORKSHEET_REFRESH_EVENT));
}
