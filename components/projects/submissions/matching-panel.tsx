"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  prepareMatching,
  matchOneByLlm,
  finalizeMatching,
} from "@/app/projects/[id]/submissions/actions";
import {
  useSequentialRun,
  type SequentialTarget,
} from "@/lib/hooks/use-sequential-run";
import { RunTerminal } from "@/components/projects/run-terminal";

// 매칭 실행 (SPEC 5.2). 명단과 모호하지 않게 일치하면 자동, 애매하면 확인 대기 큐로.
// 결정적(열·파일명) 처리는 prepare에서 끝내고, LLM 추정이 필요한 건만 실행 터미널이
// 1건씩 호출한다. 진행 중 일시정지·재개·긴급 중단할 수 있고, 재실행하면 남은 미매칭만 이어간다.
export function MatchingPanel({
  projectId,
  unmatchedCount,
  providerName,
  model,
}: {
  projectId: string;
  unmatchedCount: number;
  providerName: string;
  model: string;
}) {
  const router = useRouter();

  const prepare = useCallback(async () => {
    const { prelude, llmTargets } = await prepareMatching(projectId);
    return { targets: llmTargets, prelude };
  }, [projectId]);

  const stepOne = useCallback(
    async (t: SequentialTarget) => matchOneByLlm(projectId, t.id),
    [projectId],
  );

  const finalize = useCallback(async () => {
    await finalizeMatching(projectId);
    router.refresh();
    return "매칭 반영 완료 — 학생별 제출물·확인 큐를 확인하세요.";
  }, [projectId, router]);

  const { lines, runState, progress, start, pause, resume, stop } =
    useSequentialRun({ prepare, stepOne, finalize });

  const running =
    runState === "running" || runState === "paused" || runState === "stopping";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {/* 추출·매칭 모델 배지 (요구 ②) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          추출·매칭 모델: {providerName} / {model}
        </span>
        <Link
          href={`/projects/${projectId}/settings`}
          className="text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          모델 변경
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          미매칭 제출물 <b>{unmatchedCount}</b>건.
          <span className="ml-1 text-xs text-zinc-400">
            학번이 일치하거나 이름이 명단에 한 명뿐이면 자동 귀속합니다. 파일명에서 못 찾으면
            문서 내용을 읽어 추정하고, 동명이인·식별 불가는 확인 대기 큐로 보냅니다. 실행은
            건별로 진행되며 일시정지·재개·긴급 중단할 수 있고, 중단해도 처리분은 반영됩니다.
          </span>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={running || unmatchedCount === 0}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {running ? "매칭 중…" : "매칭 실행"}
        </button>
      </div>

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
    </div>
  );
}
