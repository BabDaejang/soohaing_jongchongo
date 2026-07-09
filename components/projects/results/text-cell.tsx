"use client";

import { useEffect, useRef } from "react";
import type { CellMode } from "@/lib/records/layout";
import { clampCellHeight } from "@/lib/records/layout";

const MODE_LABEL: Record<CellMode, string> = {
  collapsed: "접기",
  full: "전체",
  custom: "커스텀",
};

// 결과 표의 텍스트 셀(메모·생기부). 표시 모드 3종 + 편집(전체·커스텀). SPEC 8절.
//   접기: 1줄 말줄임 미리보기(클릭 시 전체로 펼침). 전체: 내용 높이 자동. 커스텀: 하단 핸들 드래그 높이.
// 텍스트 내용은 부모(Row)가 소유(카운터·저장). 이 컴포넌트는 표시·편집·모드 UI만 담당한다.
export function TextCell({
  value,
  onChange,
  onCommit,
  editable,
  mode,
  height,
  onSetMode,
  onResizeHeight,
  onCommitHeight,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  editable: boolean;
  mode: CellMode;
  height: number | undefined;
  onSetMode: (m: CellMode) => void;
  onResizeHeight: (h: number) => void; // 드래그 중 실시간 높이
  onCommitHeight: () => void; // 드래그 종료(저장 예약)
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // '전체 맞춤' 모드에서 내용 높이에 맞춰 textarea를 자동 확장한다(값·모드 변경 시).
  useEffect(() => {
    if (mode !== "full") return;
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [mode, value]);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height ?? taRef.current?.offsetHeight ?? 120;
    function move(ev: PointerEvent) {
      onResizeHeight(clampCellHeight(startH + (ev.clientY - startY)));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onCommitHeight();
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="flex flex-col gap-1">
      {/* 셀 모드 토글(행 단위) */}
      <div className="inline-flex w-fit overflow-hidden rounded border border-zinc-200 text-[10px] dark:border-zinc-700">
        {(["collapsed", "full", "custom"] as CellMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onSetMode(m)}
            className={`px-1.5 py-0.5 ${
              mode === m
                ? "bg-zinc-700 text-white dark:bg-zinc-300 dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === "collapsed" ? (
        value ? (
          <button
            type="button"
            onClick={() => onSetMode("full")}
            title="펼쳐서 편집"
            className="line-clamp-1 w-full text-left text-sm text-zinc-700 dark:text-zinc-300"
          >
            {value}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSetMode("full")}
            className="w-full text-left text-sm text-zinc-300 dark:text-zinc-600"
          >
            {placeholder ?? "(비어 있음)"}
          </button>
        )
      ) : (
        <div className="relative">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            readOnly={!editable}
            placeholder={placeholder}
            style={mode === "custom" ? { height: height ?? 120 } : undefined}
            className={`w-full resize-none rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${
              mode === "custom" ? "overflow-y-auto" : "overflow-hidden"
            }`}
          />
          {mode === "custom" && (
            <div
              onPointerDown={startResize}
              title="드래그하여 높이 조절"
              className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-center justify-center rounded-b-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
              <span className="h-0.5 w-6 rounded bg-zinc-400 dark:bg-zinc-500" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
