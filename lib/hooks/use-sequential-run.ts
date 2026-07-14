"use client";

import { useCallback, useRef, useState } from "react";
import {
  runPlanChain,
  type PoolConfig,
  type PrepareResult,
  type RunOutcome,
  type RunPlan,
  type SequentialTarget,
  type StepResult,
} from "./run-pool";

// 공용 순차/병렬 실행 훅 (리팩토링 배치 2, 4단계 — 리팩토링 3 배치 1에서 동시성·재시도·다단 연쇄 확장).
// 클라이언트가 1건 단위 서버 액션을 호출하며, 진행 표시·일시정지/재개/긴급중단·
// 연속 실패 자동 중단(서킷 브레이커)·retryable 백오프 재시도를 제공한다.
// 스케줄링 코어(run-pool.ts)는 React 비의존 순수 모듈로 분리돼 있다.
export type TermLevel = "info" | "ok" | "error" | "system";
export type TermLine = { ts: string; level: TermLevel; text: string }; // ts = "14:03:05"
export type RunState =
  | "idle"
  | "running"
  | "paused"
  | "stopping"
  | "done"
  | "aborted";

// 타입 재export (기존 소비자가 이 파일에서 import)
export type { SequentialTarget, StepResult, RunOutcome, RunPlan, PrepareResult };

function nowTs(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

export function useSequentialRun(args: {
  prepare: () => Promise<PrepareResult>;
  stepOne: (t: SequentialTarget) => Promise<StepResult>;
  finalize: (r: RunOutcome) => Promise<string | null>;
  // 스테이지 연쇄: 첫 스테이지가 정상 종료(중단 아님)하면 이어서 실행할 다음 스테이지 계획.
  // null을 반환하면 연쇄하지 않는다.
  // RunPlan.nextStage와 공존 시 훅 인자가 우선한다(경고 로그).
  nextStage?: (r: RunOutcome) => RunPlan | null;
  maxConsecutiveFailures?: number; // 기본 3
  concurrency?: number; // 1~3 클램프, 기본 1. start() 시점에 읽어 한 실행 전체 고정.
}): {
  lines: TermLine[];
  runState: RunState;
  progress: { done: number; total: number } | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
} {
  const {
    prepare,
    stepOne,
    finalize,
    nextStage,
    maxConsecutiveFailures = 3,
    concurrency: concurrencyArg,
  } = args;

  const [lines, setLines] = useState<TermLine[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  // pause/stop은 ref 플래그로 루프에서 직접 읽는다(상태 지연 없이 즉시 반영).
  const runningRef = useRef(false);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);

  const append = useCallback((level: TermLevel, text: string) => {
    setLines((prev) => [...prev, { ts: nowTs(), level, text }]);
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return; // runningRef로 이중 시작 방지
    runningRef.current = true;
    pauseRef.current = false;
    stopRef.current = false;
    setLines([]);
    setProgress(null);
    setRunState("running");

    // start() 시점에 동시성을 고정 (1~3 클램프, 기본 1)
    const rawConcurrency = concurrencyArg ?? 1;
    const concurrency = Math.max(1, Math.min(3, Math.round(rawConcurrency)));

    // 첫 plan 조립: 훅 인자 nextStage와 plan의 nextStage 공존 처리
    const firstPlan: RunPlan = { prepare, stepOne, finalize };
    if (nextStage && firstPlan.nextStage) {
      // 둘 다 있으면 훅 인자가 우선
      append("system", "nextStage가 훅 인자와 plan 양쪽에 있습니다 — 훅 인자를 우선합니다.");
      firstPlan.nextStage = nextStage;
    } else if (nextStage) {
      firstPlan.nextStage = nextStage;
    }
    // plan 자체의 nextStage는 prepare/stepOne/finalize에 포함되지 않으므로
    // firstPlan에는 nextStage가 없다. 훅 인자에서 합류시킨다.

    const poolConfig: PoolConfig = {
      concurrency,
      maxConsecutiveFailures,
      maxRetries: 2,
    };

    void (async () => {
      const result = await runPlanChain(
        [firstPlan],
        poolConfig,
        {
          isPaused: () => pauseRef.current,
          isStopped: () => stopRef.current,
          onProgress: (done, total) => setProgress({ done, total }),
          onLog: append,
        },
        5, // 연쇄 상한 5스테이지
      );

      setRunState(result.aborted ? "aborted" : "done");
      runningRef.current = false;
    })();
  }, [prepare, stepOne, finalize, nextStage, maxConsecutiveFailures, concurrencyArg, append]);

  const pause = useCallback(() => {
    if (!runningRef.current || stopRef.current || pauseRef.current) return;
    pauseRef.current = true;
    setRunState("paused");
    append("system", "일시 정지 — 진행 중인 건을 마치고 멈춥니다.");
  }, [append]);

  const resume = useCallback(() => {
    if (!runningRef.current || stopRef.current || !pauseRef.current) return;
    pauseRef.current = false;
    setRunState("running");
    append("system", "다시 시작");
  }, [append]);

  const stop = useCallback(() => {
    if (!runningRef.current || stopRef.current) return;
    stopRef.current = true;
    setRunState("stopping");
    append("system", "긴급 중단 — 처리분까지 반영하고 멈춥니다.");
  }, [append]);

  return { lines, runState, progress, start, pause, resume, stop };
}
