"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  prepareEvaluation,
  evaluateOne,
  finalizeEvaluation,
  recalculate,
} from "@/app/projects/[id]/evaluate/actions";
import {
  useSequentialRun,
  type SequentialTarget,
} from "@/lib/hooks/use-sequential-run";
import { RunTerminal } from "@/components/projects/run-terminal";

// 채점 실행 패널 (SPEC 6절). 실행 터미널로 건별 채점 → 재계산. 등급 직접 수정 없음(INV-6).
export function RunPanel({
  projectId,
  needsRecalc,
  matchedIncluded,
  scoredSubmissions,
  providerName,
  model,
}: {
  projectId: string;
  needsRecalc: boolean;
  matchedIncluded: number; // 채점 대상 제출물 수(반영+매칭)
  scoredSubmissions: number; // 현재 평가가 있는 제출물 수
  providerName: string;
  model: string;
}) {
  const router = useRouter();
  const [recalcPending, startRecalc] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // prepare가 산출한 증분 보존 건수와 대표 실패 사유를 finalize까지 전달한다.
  const skippedRef = useRef(0);
  const sampleFailureRef = useRef<string | null>(null);

  const prepare = useCallback(async () => {
    const { targets, skipped } = await prepareEvaluation(projectId);
    skippedRef.current = skipped;
    sampleFailureRef.current = null;
    return {
      targets,
      prelude: [
        {
          level: "info" as const,
          text: `채점 대상 ${targets.length}건 · 증분 보존 ${skipped}건`,
        },
      ],
    };
  }, [projectId]);

  const stepOne = useCallback(
    async (t: SequentialTarget) => {
      const r = await evaluateOne(projectId, t.id);
      if (!r.ok && !sampleFailureRef.current) sampleFailureRef.current = r.message;
      return r;
    },
    [projectId],
  );

  const finalize = useCallback(
    async ({
      succeeded,
      failed,
      aborted,
    }: {
      succeeded: number;
      failed: number;
      aborted: boolean;
    }) => {
      const { ranked, pendingConfirm } = await finalizeEvaluation(
        projectId,
        { scored: succeeded, failed, skipped: skippedRef.current },
        aborted,
        sampleFailureRef.current ?? undefined,
      );
      router.refresh();
      return pendingConfirm
        ? `채점 ${pendingConfirm.scored}/${pendingConfirm.required}명 — 표시 점수 확정 대기(최소 ${pendingConfirm.required}명 채점 후 확정)`
        : `재계산 — ${ranked}명 순위 산출`;
    },
    [projectId, router],
  );

  const { lines, runState, progress, start, pause, resume, stop } =
    useSequentialRun({ prepare, stepOne, finalize });

  const running =
    runState === "running" || runState === "paused" || runState === "stopping";

  function recalc() {
    setError(null);
    setMsg(null);
    startRecalc(async () => {
      try {
        const { ranked, pendingConfirm } = await recalculate(projectId);
        setMsg(
          pendingConfirm
            ? `채점 ${pendingConfirm.scored}/${pendingConfirm.required}명 — 표시 점수 확정 대기(최소 ${pendingConfirm.required}명 채점 후 확정)`
            : `재계산 완료 — ${ranked}명 순위 산출`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "재계산 실패");
      }
    });
  }

  const pendingCount = matchedIncluded - scoredSubmissions;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {/* 평가 모델 배지 (요구 ②) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          평가 모델: {providerName} / {model}
        </span>
        <Link
          href={`/projects/${projectId}/settings`}
          className="text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          모델 변경
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={start}
          disabled={running || recalcPending}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {running ? "채점 중…" : "채점 실행"}
        </button>
        <button
          type="button"
          onClick={recalc}
          disabled={recalcPending || running}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          재계산
        </button>
        {needsRecalc && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            ● 재계산 필요
          </span>
        )}
      </div>

      <p className="text-xs text-zinc-500">
        채점 대상(반영 체크 + 매칭 확정) 제출물 {matchedIncluded}건 중{" "}
        {scoredSubmissions}건 채점됨
        {pendingCount > 0 && ` · 미채점 ${pendingCount}건`}. 채점은 건별로 실행되며 진행 중
        일시정지·재개·긴급 중단할 수 있고, 중단해도 처리분은 반영됩니다. temperature를 지원하는
        모델은 0으로 고정하며(gpt-5 계열 미지원), 내용이 바뀌지 않은 제출물은 재채점하지
        않습니다(증분). 표시 점수는 초기 확정 인원(15~25명) 채점 후 999점 만점으로
        확정됩니다.
      </p>

      {lines.length > 0 && (
        <RunTerminal
          lines={lines}
          runState={runState}
          progress={progress}
          onPause={pause}
          onResume={resume}
          onStop={stop}
        />
      )}

      {msg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
