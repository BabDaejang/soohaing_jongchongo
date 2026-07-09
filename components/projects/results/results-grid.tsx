"use client";

import { useCallback, useRef, useState } from "react";
import { TextCell } from "./text-cell";
import { saveLayout } from "@/app/projects/[id]/results/actions";
import { saveTeacherMemo } from "@/app/projects/[id]/students/actions";
import { saveRecordEdit } from "@/app/projects/[id]/records/actions";
import { countText } from "@/lib/text-count";
import {
  clampColumnWidth,
  setAllCellModes,
  withMode,
  COLUMN_KEYS,
  DEFAULT_CUSTOM_HEIGHT,
  type CellMode,
  type CellState,
  type ColumnKey,
  type LayoutState,
} from "@/lib/records/layout";
import type { CountMethod, RecordOrigin } from "@/lib/supabase/types";

export type ResultRow = {
  studentId: string;
  name: string;
  studentNumber: string | null;
  grade: number | null; // null = 점수 스냅샷 없음(미평가)
  teacherMemo: string;
  record: { version: number; content: string; origin: RecordOrigin } | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";
type CellSaveState = SaveState | "editing";
const LAYOUT_SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "레이아웃 저장 중…",
  saved: "레이아웃 저장됨",
  error: "레이아웃 저장 실패",
};

const COLUMN_HEADER: Record<ColumnKey, string> = {
  student: "학생 정보",
  grade: "등급",
  memo: "교사 관찰 메모",
  record: "생성된 생기부",
};

// Phase 3 결과 표 (SPEC 8절). 4열 · 열 너비 드래그 · 셀 3모드 · 행/전체 토글 · 레이아웃 영속화.
export function ResultsGrid({
  projectId,
  charLimit,
  countMethod,
  rows,
  initialLayout,
}: {
  projectId: string;
  charLimit: number;
  countMethod: CountMethod;
  rows: ResultRow[];
  initialLayout: LayoutState;
}) {
  const [layout, setLayout] = useState<LayoutState>(initialLayout);
  const layoutRef = useRef<LayoutState>(initialLayout);
  const [layoutSave, setLayoutSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const studentIds = rows.map((r) => r.studentId);

  // 레이아웃 변경을 확정하고 디바운스(700ms) 저장을 예약한다. 초기 마운트에선 호출되지 않는다.
  const commit = useCallback(
    (next: LayoutState) => {
      layoutRef.current = next;
      setLayout(next);
      if (timer.current) clearTimeout(timer.current);
      setLayoutSave("saving");
      timer.current = setTimeout(async () => {
        try {
          await saveLayout(projectId, layoutRef.current);
          setLayoutSave("saved");
        } catch {
          setLayoutSave("error");
        }
      }, 700);
    },
    [projectId],
  );

  // 열 너비 드래그(헤더 경계). 실시간 반영 후 pointerup에서 저장 예약.
  function startColumnResize(key: ColumnKey, e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = layoutRef.current.columnWidths[key];
    let latest = layoutRef.current;
    function move(ev: PointerEvent) {
      const width = clampColumnWidth(startW + (ev.clientX - startX));
      latest = {
        ...layoutRef.current,
        columnWidths: { ...layoutRef.current.columnWidths, [key]: width },
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

  // 셀 표시 상태 변경(행 단위 토글·높이 드래그). save=false면 저장 예약 없이 실시간 반영만.
  const changeCell = useCallback(
    (studentId: string, key: "memo" | "record", next: CellState, save: boolean) => {
      const prevRow = layoutRef.current.cells[studentId] ?? {
        memo: { mode: "collapsed" as CellMode },
        record: { mode: "collapsed" as CellMode },
      };
      const nextLayout: LayoutState = {
        ...layoutRef.current,
        cells: {
          ...layoutRef.current.cells,
          [studentId]: { ...prevRow, [key]: next },
        },
      };
      if (save) {
        commit(nextLayout);
      } else {
        layoutRef.current = nextLayout;
        setLayout(nextLayout);
      }
    },
    [commit],
  );

  function toggleAll(mode: CellMode) {
    commit(setAllCellModes(layoutRef.current, studentIds, mode));
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        학생이 없습니다. 먼저 학생 명단을 추가하고 생기부를 생성하세요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 상단 도구: 전체 일괄 토글 + 레이아웃 저장 상태 */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-zinc-500">전체</span>
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => toggleAll("collapsed")}
            className="px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            전체 접기
          </button>
          <button
            type="button"
            onClick={() => toggleAll("full")}
            className="border-l border-zinc-300 px-3 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            전체 펼치기
          </button>
        </div>
        <span className="text-xs text-zinc-400">{LAYOUT_SAVE_LABEL[layoutSave]}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="table-fixed border-collapse text-sm">
          <colgroup>
            {COLUMN_KEYS.map((key) => (
              <col key={key} style={{ width: layout.columnWidths[key] }} />
            ))}
          </colgroup>
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
            <tr>
              {COLUMN_KEYS.map((key) => (
                <th
                  key={key}
                  className="relative border-b border-zinc-200 px-3 py-2 font-medium dark:border-zinc-800"
                >
                  {COLUMN_HEADER[key]}
                  {/* 헤더 경계 드래그 핸들 */}
                  <span
                    onPointerDown={(e) => startColumnResize(key, e)}
                    title="드래그하여 열 너비 조절"
                    className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-zinc-300 dark:hover:bg-zinc-600"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.studentId}
                projectId={projectId}
                charLimit={charLimit}
                countMethod={countMethod}
                row={row}
                cellMemo={layout.cells[row.studentId]?.memo ?? { mode: "collapsed" }}
                cellRecord={
                  layout.cells[row.studentId]?.record ?? { mode: "collapsed" }
                }
                onChangeCell={changeCell}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 행 ────────────────────────────────────────────────────────────────
function Row({
  projectId,
  charLimit,
  countMethod,
  row,
  cellMemo,
  cellRecord,
  onChangeCell,
}: {
  projectId: string;
  charLimit: number;
  countMethod: CountMethod;
  row: ResultRow;
  cellMemo: CellState;
  cellRecord: CellState;
  onChangeCell: (
    studentId: string,
    key: "memo" | "record",
    next: CellState,
    save: boolean,
  ) => void;
}) {
  const [memo, setMemo] = useState(row.teacherMemo);
  const memoSaved = useRef(row.teacherMemo);
  const [memoState, setMemoState] = useState<CellSaveState>("idle");

  const [recordText, setRecordText] = useState(row.record?.content ?? "");
  const recordSaved = useRef(row.record?.content ?? "");
  const [recordMeta, setRecordMeta] = useState(row.record);
  const [recordState, setRecordState] = useState<CellSaveState>("idle");

  // ── 저장(내용) ──
  async function commitMemo() {
    if (memo === memoSaved.current) return;
    setMemoState("saving");
    try {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("studentId", row.studentId);
      fd.set("teacher_memo", memo);
      await saveTeacherMemo(fd);
      memoSaved.current = memo;
      setMemoState("saved");
    } catch {
      setMemoState("error");
    }
  }

  // 생기부 직접 수정 → 새 'edited' 버전(수용 2). 내용이 실제로 바뀌었을 때만 저장(버전 남발 방지).
  async function commitRecord() {
    const next = recordText.trim();
    if (next === recordSaved.current.trim()) return;
    if (!next) {
      setRecordState("error"); // 빈 내용은 새 버전으로 저장하지 않음
      return;
    }
    setRecordState("saving");
    try {
      const { version } = await saveRecordEdit(projectId, row.studentId, next, []);
      recordSaved.current = next;
      setRecordMeta({ version, content: next, origin: "edited" });
      setRecordState("saved");
    } catch {
      setRecordState("error");
    }
  }

  const recordCount = countText(recordText, countMethod);
  const over = recordCount > charLimit;

  return (
    <tr className="border-t border-zinc-100 align-top dark:border-zinc-800">
      {/* 학생 정보 */}
      <td className="px-3 py-2">
        <div className="font-medium">{row.name}</div>
        {row.studentNumber && (
          <div className="text-xs text-zinc-400">{row.studentNumber}</div>
        )}
      </td>

      {/* 등급 (점수에서 파생, INV-6) */}
      <td className="px-3 py-2">
        {row.grade !== null ? (
          <span className="font-semibold">{row.grade}등급</span>
        ) : (
          <span className="text-xs text-zinc-400">미평가</span>
        )}
      </td>

      {/* 교사 관찰 메모 (편집 가능) */}
      <td className="px-3 py-2">
        <TextCell
          value={memo}
          onChange={(v) => {
            setMemo(v);
            setMemoState("editing");
          }}
          onCommit={commitMemo}
          editable
          mode={cellMemo.mode}
          height={cellMemo.height}
          onSetMode={(m) =>
            onChangeCell(row.studentId, "memo", withMode(cellMemo, m), true)
          }
          onResizeHeight={(h) =>
            onChangeCell(row.studentId, "memo", { mode: "custom", height: h }, false)
          }
          onCommitHeight={() =>
            onChangeCell(
              row.studentId,
              "memo",
              { mode: "custom", height: cellMemo.height ?? DEFAULT_CUSTOM_HEIGHT },
              true,
            )
          }
          placeholder="이 학생에 대한 관찰 내용"
        />
        <CellStatus state={memoState} />
      </td>

      {/* 생성된 생기부 (편집 가능 → 새 버전) */}
      <td className="px-3 py-2">
        <TextCell
          value={recordText}
          onChange={(v) => {
            setRecordText(v);
            setRecordState("editing");
          }}
          onCommit={commitRecord}
          editable
          mode={cellRecord.mode}
          height={cellRecord.height}
          onSetMode={(m) =>
            onChangeCell(row.studentId, "record", withMode(cellRecord, m), true)
          }
          onResizeHeight={(h) =>
            onChangeCell(row.studentId, "record", { mode: "custom", height: h }, false)
          }
          onCommitHeight={() =>
            onChangeCell(
              row.studentId,
              "record",
              { mode: "custom", height: cellRecord.height ?? DEFAULT_CUSTOM_HEIGHT },
              true,
            )
          }
          placeholder={recordMeta ? "생기부 내용" : "아직 생성된 생기부가 없습니다"}
        />
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          {recordMeta ? (
            <span className="text-zinc-400">
              v{recordMeta.version} ·{" "}
              {recordMeta.origin === "generated"
                ? "생성"
                : recordMeta.origin === "edited"
                  ? "교사 편집"
                  : "수동 작성"}
            </span>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">미생성</span>
          )}
          <span className={over ? "font-semibold text-red-600" : "text-zinc-400"}>
            {recordCount}/{charLimit}
            {countMethod === "bytes" ? "B" : "자"}
          </span>
          <CellStatus state={recordState} />
        </div>
      </td>
    </tr>
  );
}

function CellStatus({ state }: { state: CellSaveState }) {
  if (state === "idle") return null;
  const label =
    state === "saving"
      ? "저장 중…"
      : state === "saved"
        ? "저장됨"
        : state === "error"
          ? "저장 실패"
          : "입력 중…";
  return (
    <span
      className={`text-[11px] ${
        state === "error" ? "text-red-500" : "text-zinc-400"
      }`}
    >
      {label}
    </span>
  );
}
