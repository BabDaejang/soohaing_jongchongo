// 작업결과표 레이아웃 — **순수 함수**. 클라이언트(편집·복원)와 서버(saveWorksheetLayout
// 재검증, 신뢰 경계)가 동일 새니타이저를 쓴다. 저장된 jsonb는 사용자 입력에서 왔으므로
// 항상 normalizeWorksheetLayout으로 클램프·검증한 뒤 사용한다(구형 results shape도 방어한다).

import { WORKSHEET_COLUMNS, type WorksheetColumnKey, type WorksheetRow } from "./types";

export type WorksheetSort = {
  key: WorksheetColumnKey;
  dir: "asc" | "desc";
} | null;

export type WorksheetLayout = {
  widths: Record<string, number>; // px, 60~800 클램프
  hidden: WorksheetColumnKey[];
  sort: WorksheetSort;
  rowHeights: Record<string, number>; // studentId → px, 28~600 클램프
  allCollapsed: boolean; // 전체 접기(행 1줄 말줄임)
};

export const MIN_COL_WIDTH = 60;
export const MAX_COL_WIDTH = 800;
export const MIN_ROW_HEIGHT = 28;
export const MAX_ROW_HEIGHT = 600;

// 열별 기본 너비(px). 저장값이 없으면 이 값을 쓴다.
export const DEFAULT_COLUMN_WIDTHS: Record<WorksheetColumnKey, number> = {
  internal_id: 92,
  student_number: 80,
  name: 104,
  selected_book: 160,
  submission_count: 116,
  score: 92,
  grade: 72,
  record: 360,
  memo: 260,
};

// 필터 지원 열(고유값 체크박스). 값은 문자열화해 비교한다.
export const FILTERABLE_COLUMNS: WorksheetColumnKey[] = [
  "student_number",
  "name",
  "selected_book",
  "submission_count",
  "score",
  "grade",
];

// 수치 비교 열(정렬 시 localeCompare 대신 수 비교).
const NUMERIC_COLUMNS: WorksheetColumnKey[] = [
  "submission_count",
  "score",
  "grade",
];

export function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_COLUMN_WIDTHS.record;
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(w)));
}

export function clampRowHeight(h: number): number {
  if (!Number.isFinite(h)) return MIN_ROW_HEIGHT;
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.round(h)));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizeSort(raw: unknown): WorksheetSort {
  if (!isRecord(raw)) return null;
  const { key, dir } = raw;
  if (
    typeof key === "string" &&
    (WORKSHEET_COLUMNS as readonly string[]).includes(key) &&
    (dir === "asc" || dir === "desc")
  ) {
    return { key: key as WorksheetColumnKey, dir };
  }
  return null;
}

// 저장된 layout(unknown)을 현재 학생 목록에 맞춰 완전·안전한 상태로 정규화한다.
// garbage·구형(results {columnWidths, cells}) shape는 전부 기본값으로 떨어지고,
// stale studentId의 rowHeights는 제거된다.
export function normalizeWorksheetLayout(
  raw: unknown,
  studentIds: string[],
): WorksheetLayout {
  const obj = isRecord(raw) ? raw : {};

  const rawWidths = isRecord(obj.widths) ? obj.widths : {};
  const widths: Record<string, number> = {};
  for (const [key, v] of Object.entries(rawWidths)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      if ((WORKSHEET_COLUMNS as readonly string[]).includes(key) || key.startsWith("sub_detail_")) {
        widths[key] = clampWidth(v);
      }
    }
  }

  // hidden: 유효 키만·순서 정규화·중복 제거.
  const rawHidden = Array.isArray(obj.hidden) ? (obj.hidden as unknown[]) : [];
  const hidden = WORKSHEET_COLUMNS.filter((k) => rawHidden.includes(k));

  const sort = sanitizeSort(obj.sort);

  const idSet = new Set(studentIds);
  const rawHeights = isRecord(obj.rowHeights) ? obj.rowHeights : {};
  const rowHeights: Record<string, number> = {};
  for (const [id, v] of Object.entries(rawHeights)) {
    if (idSet.has(id) && typeof v === "number" && Number.isFinite(v)) {
      rowHeights[id] = clampRowHeight(v);
    }
  }

  return { widths, hidden, sort, rowHeights, allCollapsed: obj.allCollapsed === true };
}

// 정렬·필터 공용 셀 값 추출(원시값 — 정렬은 null/빈 값을 끝으로, 필터는 문자열화).
function cellValue(row: WorksheetRow, key: WorksheetColumnKey): string | number | null {
  switch (key) {
    case "internal_id":
      return row.studentId;
    case "student_number":
      return row.studentNumber;
    case "name":
      return row.name;
    case "selected_book":
      return row.selectedBooks.map((b) => b.title).join(", ");
    case "submission_count":
      return row.submissionCount;
    case "score":
      return row.displayScore;
    case "grade":
      return row.grade;
    case "record":
      return row.recordContent;
    case "memo":
      return row.memo;
  }
}

function isEmpty(v: string | number | null): boolean {
  return v === null || v === undefined || v === "";
}

// 필터/체크박스에서 쓰는 셀 문자열(빈 값 = "").
export function worksheetFilterValue(row: WorksheetRow, key: WorksheetColumnKey): string {
  const v = cellValue(row, key);
  return v === null || v === undefined ? "" : String(v);
}

// null·빈 값은 방향과 무관하게 항상 끝. 숫자 열은 수치 비교, 텍스트는 localeCompare("ko").
export function applySort(rows: WorksheetRow[], sort: WorksheetSort): WorksheetRow[] {
  if (!sort) return rows;
  const { key, dir } = sort;
  const numeric = NUMERIC_COLUMNS.includes(key);
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = cellValue(a, key);
    const vb = cellValue(b, key);
    const ea = isEmpty(va);
    const eb = isEmpty(vb);
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    if (numeric) return (Number(va) - Number(vb)) * factor;
    return String(va).localeCompare(String(vb), "ko") * factor;
  });
}

// 필터: 선택 열마다 선택값 집합에 속하는 행만 남긴다("" = 빈 값 항목).
export function applyFilters(
  rows: WorksheetRow[],
  filters: Partial<Record<WorksheetColumnKey, string[]>>,
): WorksheetRow[] {
  let result = rows;
  for (const key of FILTERABLE_COLUMNS) {
    const selected = filters[key];
    if (!selected || selected.length === 0) continue;
    const set = new Set(selected);
    result = result.filter((r) => set.has(worksheetFilterValue(r, key)));
  }
  return result;
}
