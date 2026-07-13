"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchWorksheetRows,
  saveWorksheetLayout,
} from "@/app/projects/[id]/worksheet-actions";
import {
  WORKSHEET_COLUMNS,
  COLUMN_LABELS,
  type WorksheetColumnKey,
  type WorksheetRow,
} from "@/lib/worksheet/types";
import {
  applyFilters,
  applySort,
  clampRowHeight,
  clampWidth,
  normalizeWorksheetLayout,
  worksheetFilterValue,
  DEFAULT_COLUMN_WIDTHS,
  FILTERABLE_COLUMNS,
  MIN_ROW_HEIGHT,
  type WorksheetLayout,
  type WorksheetSort,
} from "@/lib/worksheet/layout";
import { WORKSHEET_REFRESH_EVENT } from "@/lib/worksheet/refresh";
import {
  buildWorksheetAoA,
  formatDownloadStamp,
  sanitizeFilename,
} from "@/lib/worksheet/download";

type Filters = Partial<Record<WorksheetColumnKey, string[]>>;
type SaveState = "idle" | "saving" | "saved" | "error";
type DownloadFormat = "xlsx" | "csv" | "md";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "레이아웃 저장 중…",
  saved: "레이아웃 저장됨",
  error: "레이아웃 저장 실패",
};

// 작업결과표 (엑셀 시트형 8열, 전폭). 정렬·필터·열 감춤·열 너비·행 높이·전체 접기/펼치기·
// 다운로드(xlsx/csv/md)·레이아웃 저장·갱신 이벤트 수신. 셀 편집·앵커 스크롤은 배치 4.
export function WorksheetTable({
  projectId,
  projectName,
  initialRows,
  initialLayout,
}: {
  projectId: string;
  projectName: string;
  initialRows: WorksheetRow[];
  initialLayout: unknown;
}) {
  const [rows, setRows] = useState<WorksheetRow[]>(initialRows);
  const [layout, setLayout] = useState<WorksheetLayout>(() =>
    normalizeWorksheetLayout(
      initialLayout,
      initialRows.map((r) => r.studentId),
    ),
  );
  const [filters, setFilters] = useState<Filters>({}); // 세션 상태만(레이아웃에 저장 안 함)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [openMenu, setOpenMenu] = useState<WorksheetColumnKey | null>(null);
  const [downloadOpen, setDownloadOpen] = useState<"all" | "selected" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const layoutRef = useRef<WorksheetLayout>(layout);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 레이아웃 변경 확정 + 디바운스(700ms) 저장.
  const commit = useCallback(
    (next: WorksheetLayout) => {
      layoutRef.current = next;
      setLayout(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          await saveWorksheetLayout(projectId, layoutRef.current);
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      }, 700);
    },
    [projectId],
  );

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchWorksheetRows(projectId);
      setRows(next);
    } catch {
      // 조용히 실패(다음 이벤트·수동 새로고침에서 재시도)
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  // 갱신 이벤트 수신 → 800ms 디바운스 → 재조회.
  useEffect(() => {
    function onRefresh() {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(reload, 800);
    }
    window.addEventListener(WORKSHEET_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener(WORKSHEET_REFRESH_EVENT, onRefresh);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [reload]);

  // 화면 표시 행: 필터 → 정렬.
  const visibleRows = useMemo(
    () => applySort(applyFilters(rows, filters), layout.sort),
    [rows, filters, layout.sort],
  );

  const visibleColumns = useMemo(
    () => WORKSHEET_COLUMNS.filter((k) => !layout.hidden.includes(k)),
    [layout.hidden],
  );

  // ── 열 정렬/감춤 ──────────────────────────────────────────────────────
  function setSort(sort: WorksheetSort) {
    commit({ ...layoutRef.current, sort });
    setOpenMenu(null);
  }
  function hideColumn(key: WorksheetColumnKey) {
    if (layoutRef.current.hidden.includes(key)) return;
    commit({ ...layoutRef.current, hidden: [...layoutRef.current.hidden, key] });
    setOpenMenu(null);
  }
  function showAllColumns() {
    commit({ ...layoutRef.current, hidden: [] });
  }
  function toggleCollapsed() {
    commit({ ...layoutRef.current, allCollapsed: !layoutRef.current.allCollapsed });
  }

  // ── 필터(세션 상태) ───────────────────────────────────────────────────
  function setColumnFilter(key: WorksheetColumnKey, values: string[]) {
    setFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[key];
      else next[key] = values;
      return next;
    });
  }

  // ── 열 너비 드래그(헤더 우측 경계) ────────────────────────────────────
  function startColumnResize(key: WorksheetColumnKey, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = layoutRef.current.widths[key] ?? DEFAULT_COLUMN_WIDTHS[key];
    let latest = layoutRef.current;
    function move(ev: PointerEvent) {
      const width = clampWidth(startW + (ev.clientX - startX));
      latest = {
        ...layoutRef.current,
        widths: { ...layoutRef.current.widths, [key]: width },
      };
      layoutRef.current = latest;
      setLayout(latest);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit(latest);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── 행 높이 드래그(행 하단 경계) ──────────────────────────────────────
  function startRowResize(studentId: string, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = layoutRef.current.rowHeights[studentId] ?? MIN_ROW_HEIGHT + 12;
    let latest = layoutRef.current;
    function move(ev: PointerEvent) {
      const height = clampRowHeight(startH + (ev.clientY - startY));
      latest = {
        ...layoutRef.current,
        rowHeights: { ...layoutRef.current.rowHeights, [studentId]: height },
      };
      layoutRef.current = latest;
      setLayout(latest);
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit(latest);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── 선택(내보내기용) ─────────────────────────────────────────────────
  function toggleRow(studentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.studentId));
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of visibleRows) next.delete(r.studentId);
      } else {
        for (const r of visibleRows) next.add(r.studentId);
      }
      return next;
    });
  }

  // ── 다운로드(정렬 반영·필터 무시·전체 열) ────────────────────────────
  async function download(format: DownloadFormat, onlySelected: boolean) {
    setDownloadOpen(null);
    const source = onlySelected
      ? rows.filter((r) => selected.has(r.studentId))
      : rows;
    const exportRows = applySort(source, layout.sort);
    const aoa = buildWorksheetAoA(exportRows);
    const base = `${sanitizeFilename(projectName)}-${formatDownloadStamp(new Date())}`;

    if (format === "xlsx") {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "작업결과표");
      XLSX.writeFile(wb, `${base}.xlsx`);
    } else if (format === "csv") {
      const csv = aoa.map((row) => row.map(csvCell).join(",")).join("\r\n");
      downloadBlob("﻿" + csv, `${base}.csv`, "text/csv;charset=utf-8");
    } else {
      downloadBlob(buildMarkdown(aoa), `${base}.md`, "text/markdown;charset=utf-8");
    }
  }

  const collapsed = layout.allCollapsed;

  return (
    <div className="flex flex-col gap-3">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            {collapsed ? "전체 펼치기" : "전체 접기"}
          </button>
        </div>

        {layout.hidden.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            감춘 열 {layout.hidden.length}개
            <button
              type="button"
              onClick={showAllColumns}
              className="rounded border border-zinc-300 px-1.5 py-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              모두 표시
            </button>
          </span>
        )}

        {/* 다운로드(전체) */}
        <div className="relative">
          <button
            type="button"
            onClick={() =>
              setDownloadOpen((v) => (v === "all" ? null : "all"))
            }
            className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            다운로드 ▾
          </button>
          {downloadOpen === "all" && (
            <DownloadMenu onPick={(f) => download(f, false)} />
          )}
        </div>

        {/* 다운로드(선택) */}
        {selected.size > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setDownloadOpen((v) => (v === "selected" ? null : "selected"))
              }
              className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              선택 {selected.size}행 다운로드 ▾
            </button>
            {downloadOpen === "selected" && (
              <DownloadMenu onPick={(f) => download(f, true)} />
            )}
          </div>
        )}

        <button
          type="button"
          onClick={reload}
          disabled={refreshing}
          className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {refreshing ? "새로고침 중…" : "새로고침"}
        </button>

        <span className="text-xs text-zinc-400">
          {visibleRows.length}행
          {visibleRows.length !== rows.length && ` (전체 ${rows.length})`}
        </span>
        <span className="text-xs text-zinc-400">{SAVE_LABEL[saveState]}</span>
      </div>

      {/* 표 */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: 38 }} />
            {visibleColumns.map((key) => (
              <col
                key={key}
                style={{ width: layout.widths[key] ?? DEFAULT_COLUMN_WIDTHS[key] }}
              />
            ))}
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-10 bg-zinc-100 text-left dark:bg-zinc-900">
              <th className="border border-zinc-200 px-1 py-2 text-center dark:border-zinc-800">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="전체 선택"
                />
              </th>
              {visibleColumns.map((key) => (
                <HeaderCell
                  key={key}
                  columnKey={key}
                  sort={layout.sort}
                  open={openMenu === key}
                  filterable={FILTERABLE_COLUMNS.includes(key)}
                  filterValues={
                    FILTERABLE_COLUMNS.includes(key) ? uniqueValues(rows, key) : []
                  }
                  selectedFilter={filters[key] ?? []}
                  onToggleMenu={() =>
                    setOpenMenu((v) => (v === key ? null : key))
                  }
                  onSort={setSort}
                  onHide={() => hideColumn(key)}
                  onFilter={(vals) => setColumnFilter(key, vals)}
                  onResizeStart={(e) => startColumnResize(key, e)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="border border-zinc-200 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800"
                >
                  {rows.length === 0
                    ? "학생이 없습니다. 페이즈 1에서 자료를 수합하거나 학생을 추가하세요."
                    : "필터에 해당하는 행이 없습니다."}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <WorksheetRowView
                  key={row.studentId}
                  row={row}
                  columns={visibleColumns}
                  collapsed={collapsed}
                  rowHeight={layout.rowHeights[row.studentId]}
                  selected={selected.has(row.studentId)}
                  onToggle={() => toggleRow(row.studentId)}
                  onRowResizeStart={(e) => startRowResize(row.studentId, e)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 메뉴 열림 시 바깥 클릭으로 닫기 */}
      {(openMenu !== null || downloadOpen !== null) && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setOpenMenu(null);
            setDownloadOpen(null);
          }}
        />
      )}
    </div>
  );
}

// ── 헤더 셀 ──────────────────────────────────────────────────────────────
function HeaderCell({
  columnKey,
  sort,
  open,
  filterable,
  filterValues,
  selectedFilter,
  onToggleMenu,
  onSort,
  onHide,
  onFilter,
  onResizeStart,
}: {
  columnKey: WorksheetColumnKey;
  sort: WorksheetSort;
  open: boolean;
  filterable: boolean;
  filterValues: string[];
  selectedFilter: string[];
  onToggleMenu: () => void;
  onSort: (sort: WorksheetSort) => void;
  onHide: () => void;
  onFilter: (values: string[]) => void;
  onResizeStart: (e: React.PointerEvent) => void;
}) {
  const active = sort?.key === columnKey ? sort.dir : null;
  const filtering = selectedFilter.length > 0;

  return (
    <th className="relative border border-zinc-200 px-2 py-2 font-medium dark:border-zinc-800">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate" title={COLUMN_LABELS[columnKey]}>
          {COLUMN_LABELS[columnKey]}
          {active === "asc" && " ↑"}
          {active === "desc" && " ↓"}
          {filtering && " ⚑"}
        </span>
        <button
          type="button"
          onClick={onToggleMenu}
          className="shrink-0 rounded px-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          aria-label={`${COLUMN_LABELS[columnKey]} 열 메뉴`}
        >
          ▾
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-1 text-left text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <MenuItem onClick={() => onSort({ key: columnKey, dir: "asc" })}>
            오름차순
          </MenuItem>
          <MenuItem onClick={() => onSort({ key: columnKey, dir: "desc" })}>
            내림차순
          </MenuItem>
          <MenuItem onClick={() => onSort(null)}>정렬 해제</MenuItem>

          {filterable && filterValues.length > 0 && (
            <>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
              <div className="flex items-center justify-between px-2 py-1 text-xs text-zinc-500">
                <span>필터</span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => onFilter([...filterValues])}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => onFilter([])}
                  >
                    해제
                  </button>
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filterValues.map((v) => {
                  const checked = selectedFilter.includes(v);
                  return (
                    <label
                      key={v}
                      className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          onFilter(
                            checked
                              ? selectedFilter.filter((x) => x !== v)
                              : [...selectedFilter, v],
                          )
                        }
                      />
                      <span className="truncate">{v === "" ? "(빈 값)" : v}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
          <MenuItem onClick={onHide}>이 열 감추기</MenuItem>
        </div>
      )}

      {/* 열 너비 조절 핸들 */}
      <span
        onPointerDown={onResizeStart}
        title="드래그하여 열 너비 조절"
        className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-600"
      />
    </th>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

// ── 행 ────────────────────────────────────────────────────────────────
function WorksheetRowView({
  row,
  columns,
  collapsed,
  rowHeight,
  selected,
  onToggle,
  onRowResizeStart,
}: {
  row: WorksheetRow;
  columns: WorksheetColumnKey[];
  collapsed: boolean;
  rowHeight: number | undefined;
  selected: boolean;
  onToggle: () => void;
  onRowResizeStart: (e: React.PointerEvent) => void;
}) {
  return (
    <tr className="align-top hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
      <td className="relative border border-zinc-200 px-1 py-1 text-center dark:border-zinc-800">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`${row.name} 선택`}
        />
        {/* 행 높이 조절 핸들 */}
        <span
          onPointerDown={onRowResizeStart}
          title="드래그하여 행 높이 조절"
          className="absolute -bottom-0.5 left-0 z-10 h-1.5 w-full cursor-row-resize hover:bg-zinc-300 dark:hover:bg-zinc-600"
        />
      </td>
      {columns.map((key) => (
        <td
          key={key}
          className="border border-zinc-200 px-2 py-1 dark:border-zinc-800"
        >
          <Cell row={row} columnKey={key} collapsed={collapsed} rowHeight={rowHeight} />
        </td>
      ))}
    </tr>
  );
}

function Cell({
  row,
  columnKey,
  collapsed,
  rowHeight,
}: {
  row: WorksheetRow;
  columnKey: WorksheetColumnKey;
  collapsed: boolean;
  rowHeight: number | undefined;
}) {
  switch (columnKey) {
    case "internal_id":
      return (
        <span className="font-mono text-xs text-zinc-500" title={row.studentId}>
          {row.studentId.slice(0, 8)}
        </span>
      );
    case "student_number":
      return <span>{row.studentNumber ?? ""}</span>;
    case "name":
      return <span className="font-medium">{row.name}</span>;
    case "submission_count":
      return <span>{row.submissionCount}</span>;
    case "score":
      return row.displayScore !== null ? (
        <span className="inline-flex items-center gap-1">
          {row.hasOverride && (
            <span
              title={row.overrideReason ?? "교사 보정"}
              className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
            />
          )}
          {row.displayScore}
        </span>
      ) : null;
    case "grade":
      return row.grade !== null ? (
        <span className="font-semibold">{row.grade}등급</span>
      ) : null;
    case "record":
      return (
        <TextCell text={row.recordContent ?? ""} collapsed={collapsed} rowHeight={rowHeight} />
      );
    case "memo":
      return <TextCell text={row.memo} collapsed={collapsed} rowHeight={rowHeight} />;
  }
}

// 긴 텍스트 셀(생기부·메모). 전체 접기면 1줄 말줄임(rowHeights 무시), 아니면 전문(행 높이 제한 시 스크롤).
function TextCell({
  text,
  collapsed,
  rowHeight,
}: {
  text: string;
  collapsed: boolean;
  rowHeight: number | undefined;
}) {
  if (collapsed) {
    return <div className="truncate text-zinc-700 dark:text-zinc-300">{text}</div>;
  }
  return (
    <div
      className="overflow-y-auto whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300"
      style={rowHeight ? { maxHeight: rowHeight } : undefined}
    >
      {text}
    </div>
  );
}

function DownloadMenu({ onPick }: { onPick: (f: DownloadFormat) => void }) {
  return (
    <div className="absolute left-0 top-full z-30 mt-1 w-28 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <MenuItem onClick={() => onPick("xlsx")}>xlsx</MenuItem>
      <MenuItem onClick={() => onPick("csv")}>csv</MenuItem>
      <MenuItem onClick={() => onPick("md")}>md</MenuItem>
    </div>
  );
}

// ── 순수 헬퍼(컴포넌트 로컬) ────────────────────────────────────────────
function uniqueValues(rows: WorksheetRow[], key: WorksheetColumnKey): string[] {
  const set = new Set<string>();
  for (const r of rows) set.add(worksheetFilterValue(r, key));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function mdCell(v: string | number): string {
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function buildMarkdown(aoa: (string | number)[][]): string {
  const [header, ...body] = aoa;
  const lines = [
    "| " + header.map(mdCell).join(" | ") + " |",
    "| " + header.map(() => "---").join(" | ") + " |",
  ];
  for (const r of body) lines.push("| " + r.map(mdCell).join(" | ") + " |");
  return lines.join("\n");
}

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
