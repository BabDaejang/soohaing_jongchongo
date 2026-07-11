"use client";

import { useEffect, useRef } from "react";
import type { RunState, TermLevel, TermLine } from "@/lib/hooks/use-sequential-run";

// 공용 실행 터미널 (리팩토링 배치 2, 4단계). 표시 전용 — 채점·매칭 등이 재사용한다.
// 실행 로직은 useSequentialRun이 담당하고, 여기서는 로그·진행·제어 버튼만 렌더한다.
const LEVEL_COLOR: Record<TermLevel, string> = {
  ok: "text-emerald-400",
  error: "text-red-400",
  system: "text-amber-300",
  info: "text-zinc-300",
};

export function RunTerminal({
  lines,
  runState,
  progress,
  onPause,
  onResume,
  onStop,
}: {
  lines: TermLine[];
  runState: RunState;
  progress: { done: number; total: number } | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  // 자동 스크롤: 새 로그가 붙을 때 맨 아래로.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const running = runState === "running";
  const paused = runState === "paused";

  const ctrlBtn =
    "rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
  const stopBtn =
    "rounded-md border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-500">
          진행 {progress ? `${progress.done}/${progress.total}` : "0/0"}
          {runState === "done" && " · 완료"}
          {runState === "aborted" && " · 중단됨"}
          {runState === "stopping" && " · 중단 중…"}
        </span>
        <div className="flex items-center gap-2">
          {running && (
            <>
              <button type="button" onClick={onPause} className={ctrlBtn}>
                일시 정지
              </button>
              <button type="button" onClick={onStop} className={stopBtn}>
                긴급 중단
              </button>
            </>
          )}
          {paused && (
            <>
              <button type="button" onClick={onResume} className={ctrlBtn}>
                다시 시작
              </button>
              <button type="button" onClick={onStop} className={stopBtn}>
                긴급 중단
              </button>
            </>
          )}
        </div>
      </div>

      <div
        ref={logRef}
        className="font-mono text-xs bg-zinc-950 text-zinc-200 rounded-md p-3 h-56 min-h-32 max-w-full resize overflow-auto"
      >
        {lines.length === 0 ? (
          <p className="text-zinc-500">로그가 여기에 표시됩니다.</p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={LEVEL_COLOR[l.level]}>
              <span className="text-zinc-500">[{l.ts}]</span> {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
