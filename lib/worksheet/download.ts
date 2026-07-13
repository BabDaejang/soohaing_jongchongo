// 작업결과표 다운로드 — 순수 헬퍼(테스트 대상). 실제 파일 생성(xlsx 동적 import·Blob)은
// 컴포넌트에서 수행한다. 파일명 규칙(공유 계약): `${sanitize(프로젝트명)}-${yymmddHHmm}.ext`.

import { WORKSHEET_COLUMNS, COLUMN_LABELS, type WorksheetRow } from "./types";

// 로컬 시간 yymmddHHmm (예: 2026-07-12 15:44 → "2607121544").
export function formatDownloadStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    p(d.getFullYear() % 100) +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    p(d.getHours()) +
    p(d.getMinutes())
  );
}

// 파일명에서 금지 문자 제거·trim. 빈 값이면 "project".
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return cleaned || "project";
}

// 헤더 8열 + 각 행. 제출물 갯수·점수·등급은 숫자(값 없으면 ""), 생기부·메모는 전문.
export function buildWorksheetAoA(rows: WorksheetRow[]): (string | number)[][] {
  const header: (string | number)[] = WORKSHEET_COLUMNS.map((k) => COLUMN_LABELS[k]);
  const body = rows.map((r): (string | number)[] => [
    r.studentId,
    r.studentNumber ?? "",
    r.name,
    r.submissionCount,
    r.displayScore ?? "",
    r.grade ?? "",
    r.recordContent ?? "",
    r.memo,
  ]);
  return [header, ...body];
}
