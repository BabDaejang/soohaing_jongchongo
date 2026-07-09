// 결과 표 레이아웃 (SPEC 8절, DATA_MODEL 13절 ui_layouts.layout). **순수 함수** —
// 클라이언트(편집·복원)와 서버(saveLayout 재검증, 신뢰 경계)가 동일 새니타이저를 쓴다.
// 저장된 jsonb는 사용자 입력에서 왔으므로 항상 normalizeLayout으로 클램프·검증한 뒤 사용한다.

// 텍스트 셀 표시 모드: 접기(1줄 말줄임) / 전체 맞춤(내용 높이) / 커스텀(핸들 드래그 높이).
export type CellMode = "collapsed" | "full" | "custom";

// 표 4열 (학생 정보 | 등급 | 교사 메모 | 생성된 생기부).
export type ColumnKey = "student" | "grade" | "memo" | "record";

// 텍스트 셀(메모·생기부)만 mode/height를 가진다. height는 mode='custom'에서만 의미.
export type CellState = { mode: CellMode; height?: number };
export type RowLayout = { memo: CellState; record: CellState };

export type LayoutState = {
  columnWidths: Record<ColumnKey, number>;
  cells: Record<string, RowLayout>; // studentId → 두 텍스트 셀 상태
};

export const COLUMN_KEYS: ColumnKey[] = ["student", "grade", "memo", "record"];
export const CELL_MODES: CellMode[] = ["collapsed", "full", "custom"];

export const DEFAULT_COLUMN_WIDTHS: Record<ColumnKey, number> = {
  student: 160,
  grade: 88,
  memo: 320,
  record: 480,
};

export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 1200;
export const MIN_CELL_HEIGHT = 32;
export const MAX_CELL_HEIGHT = 2000;
export const DEFAULT_CUSTOM_HEIGHT = 120;
export const DEFAULT_CELL_MODE: CellMode = "collapsed";

export function clampColumnWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_COLUMN_WIDTHS.memo;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(w)));
}

export function clampCellHeight(h: number): number {
  if (!Number.isFinite(h)) return DEFAULT_CUSTOM_HEIGHT;
  return Math.min(MAX_CELL_HEIGHT, Math.max(MIN_CELL_HEIGHT, Math.round(h)));
}

function defaultCellState(): CellState {
  return { mode: DEFAULT_CELL_MODE };
}

function defaultRowLayout(): RowLayout {
  return { memo: defaultCellState(), record: defaultCellState() };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// 저장된 셀 상태 1개를 새니타이즈한다. mode가 유효하지 않으면 기본값.
function sanitizeCellState(raw: unknown): CellState {
  if (!isRecord(raw)) return defaultCellState();
  const mode = CELL_MODES.includes(raw.mode as CellMode)
    ? (raw.mode as CellMode)
    : DEFAULT_CELL_MODE;
  const state: CellState = { mode };
  // height는 custom에서만 유지(다른 모드에선 불필요한 값 제거).
  if (mode === "custom") {
    state.height =
      typeof raw.height === "number"
        ? clampCellHeight(raw.height)
        : DEFAULT_CUSTOM_HEIGHT;
  }
  return state;
}

function sanitizeRowLayout(raw: unknown): RowLayout {
  if (!isRecord(raw)) return defaultRowLayout();
  return {
    memo: sanitizeCellState(raw.memo),
    record: sanitizeCellState(raw.record),
  };
}

// 저장된 layout jsonb(unknown)를 현재 학생 목록에 맞춰 완전·안전한 상태로 정규화한다.
// - 열 너비: 각 열을 min/max로 클램프, 없으면 기본값.
// - 셀 상태: 주어진 studentId만 포함(존재하지 않는 stale id 제거), 없는 학생은 기본값으로 채움.
export function normalizeLayout(
  raw: unknown,
  studentIds: string[],
): LayoutState {
  const rawObj = isRecord(raw) ? raw : {};
  const rawWidths = isRecord(rawObj.columnWidths) ? rawObj.columnWidths : {};
  const rawCells = isRecord(rawObj.cells) ? rawObj.cells : {};

  const columnWidths = {} as Record<ColumnKey, number>;
  for (const key of COLUMN_KEYS) {
    const v = rawWidths[key];
    columnWidths[key] =
      typeof v === "number"
        ? clampColumnWidth(v)
        : DEFAULT_COLUMN_WIDTHS[key];
  }

  const cells: Record<string, RowLayout> = {};
  for (const id of studentIds) {
    cells[id] = id in rawCells ? sanitizeRowLayout(rawCells[id]) : defaultRowLayout();
  }

  return { columnWidths, cells };
}

// 전체 일괄 토글: 모든 행의 두 텍스트 셀 모드를 mode로 설정한다(전체 접기/펼치기).
// custom으로 일괄 전환할 때는 기존 height를 유지하거나 기본 높이를 부여한다.
export function setAllCellModes(
  state: LayoutState,
  studentIds: string[],
  mode: CellMode,
): LayoutState {
  const cells: Record<string, RowLayout> = {};
  for (const id of studentIds) {
    const prev = state.cells[id] ?? defaultRowLayout();
    cells[id] = {
      memo: withMode(prev.memo, mode),
      record: withMode(prev.record, mode),
    };
  }
  return { ...state, cells };
}

// 셀 하나의 모드를 바꾼다(custom이면 height 확보, 아니면 height 제거).
export function withMode(cell: CellState, mode: CellMode): CellState {
  if (mode === "custom") {
    return { mode, height: cell.height ?? DEFAULT_CUSTOM_HEIGHT };
  }
  return { mode };
}
