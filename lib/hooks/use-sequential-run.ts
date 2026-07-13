"use client";

import { useCallback, useRef, useState } from "react";

// 공용 순차 실행 훅 (리팩토링 배치 2, 4단계).
// 클라이언트가 1건 단위 서버 액션을 순차 호출하며, 진행 표시·일시정지/재개/긴급중단·
// 연속 실패 자동 중단(서킷 브레이커)을 제공한다. 채점·매칭 등 여러 파이프라인이 재사용한다.
export type TermLevel = "info" | "ok" | "error" | "system";
export type TermLine = { ts: string; level: TermLevel; text: string }; // ts = "14:03:05"
export type RunState =
  | "idle"
  | "running"
  | "paused"
  | "stopping"
  | "done"
  | "aborted";
export type SequentialTarget = { id: string; label: string };
export type PrepareResult = {
  targets: SequentialTarget[];
  prelude?: { level: TermLevel; text: string }[]; // 대상 요약·결정적 처리 결과 등 선행 로그
};
export type StepResult = { ok: boolean; message: string };
export type RunOutcome = { succeeded: number; failed: number; aborted: boolean };
// 한 스테이지의 실행 계획. nextStage 연쇄에서 두 번째 스테이지를 기술할 때도 쓴다.
export type RunPlan = {
  prepare: () => Promise<PrepareResult>;
  stepOne: (t: SequentialTarget) => Promise<StepResult>;
  finalize: (r: RunOutcome) => Promise<string | null>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function nowTs(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

export function useSequentialRun(args: {
  prepare: () => Promise<PrepareResult>;
  stepOne: (t: SequentialTarget) => Promise<StepResult>;
  finalize: (r: RunOutcome) => Promise<string | null>;
  // 첫 스테이지가 정상 종료(중단 아님)하면 이어서 실행할 두 번째 스테이지 계획.
  // null을 반환하면 연쇄하지 않는다. 연쇄는 1회만(재귀 없음).
  nextStage?: (r: RunOutcome) => RunPlan | null;
  maxConsecutiveFailures?: number; // 기본 3
}): {
  lines: TermLine[];
  runState: RunState;
  progress: { done: number; total: number } | null;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
} {
  const { prepare, stepOne, finalize, nextStage, maxConsecutiveFailures = 3 } =
    args;

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

    // 한 스테이지(prepare → step×N → finalize)를 실행한다. progress는 스테이지마다
    // 리셋하고, lines는 초기화하지 않고 이어 붙는다(연쇄 시 앞 스테이지 로그 보존).
    const runPlan = async (plan: RunPlan): Promise<RunOutcome> => {
      let succeeded = 0;
      let failed = 0;
      let consecutive = 0;
      let aborted = false;

      let prep: PrepareResult;
      try {
        prep = await plan.prepare();
      } catch (e) {
        append(
          "error",
          e instanceof Error ? e.message : "준비 중 오류가 발생했습니다.",
        );
        return { succeeded, failed, aborted: true };
      }

      for (const p of prep.prelude ?? []) append(p.level, p.text);

      const targets = prep.targets;
      setProgress({ done: 0, total: targets.length });

      for (let i = 0; i < targets.length; i++) {
        // 일시정지: 다음 스텝 직전 250ms 폴링으로 대기(진행 중이던 1건은 이미 완료).
        while (pauseRef.current && !stopRef.current) {
          await sleep(250);
        }
        // 긴급 중단: 다음 스텝 직전 루프 종료 → finalize(aborted:true).
        if (stopRef.current) {
          aborted = true;
          break;
        }

        const t = targets[i];
        try {
          const r = await plan.stepOne(t);
          append(r.ok ? "ok" : "error", `${t.label} — ${r.message}`);
          if (r.ok) {
            succeeded += 1;
            consecutive = 0;
          } else {
            failed += 1;
            consecutive += 1;
          }
        } catch (e) {
          failed += 1;
          consecutive += 1;
          append(
            "error",
            `${t.label} — ${e instanceof Error ? e.message : "처리 중 오류"}`,
          );
        }
        setProgress({ done: i + 1, total: targets.length });

        // 서킷 브레이커: 연속 실패가 한도에 닿으면 자동 중단.
        if (consecutive >= maxConsecutiveFailures) {
          aborted = true;
          append("system", `연속 실패 ${maxConsecutiveFailures}건 — 자동 중단`);
          break;
        }
      }

      try {
        const msg = await plan.finalize({ succeeded, failed, aborted });
        if (msg) append("system", msg);
      } catch (e) {
        append(
          "error",
          e instanceof Error ? e.message : "마무리 중 오류가 발생했습니다.",
        );
        aborted = true;
      }

      return { succeeded, failed, aborted };
    };

    void (async () => {
      const first = await runPlan({ prepare, stepOne, finalize });
      let aborted = first.aborted;

      // 첫 스테이지가 정상 종료면 연쇄 스테이지를 이어 실행(1회만).
      if (!aborted && nextStage) {
        const plan2 = nextStage(first);
        if (plan2) {
          append("system", "── 다음 단계 ──");
          const second = await runPlan(plan2);
          aborted = second.aborted;
        }
      }

      setRunState(aborted ? "aborted" : "done");
      runningRef.current = false;
    })();
  }, [prepare, stepOne, finalize, nextStage, maxConsecutiveFailures, append]);

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
