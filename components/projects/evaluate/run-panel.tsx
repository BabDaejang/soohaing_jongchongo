"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runEvaluation,
  recalculate,
  type EvalSummary,
} from "@/app/projects/[id]/evaluate/actions";

export function RunPanel({
  projectId,
  needsRecalc,
  matchedIncluded,
  scoredSubmissions,
}: {
  projectId: string;
  needsRecalc: boolean;
  matchedIncluded: number; // 채점 대상 제출물 수(반영+매칭)
  scoredSubmissions: number; // 현재 평가가 있는 제출물 수
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setMsg(null);
    startTransition(async () => {
      try {
        const s = await runEvaluation(projectId);
        setSummary(s);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "채점 실패");
      }
    });
  }

  function recalc() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      try {
        const ranked = await recalculate(projectId);
        setMsg(`재계산 완료 — ${ranked}명 순위 산출`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "재계산 실패");
      }
    });
  }

  const pendingCount = matchedIncluded - scoredSubmissions;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "처리 중…" : "채점 실행"}
        </button>
        <button
          type="button"
          onClick={recalc}
          disabled={pending}
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
        {pendingCount > 0 && ` · 미채점 ${pendingCount}건`}. 채점은 temperature 0으로
        결정적이며, 내용이 바뀌지 않은 제출물은 재채점하지 않습니다(증분).
      </p>

      {summary && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          채점 완료 — 신규 {summary.scored}건 · 증분 보존 {summary.skipped}건
          {summary.failed > 0 && ` · 실패 ${summary.failed}건`} · 순위 산출{" "}
          {summary.ranked}명
        </p>
      )}
      {msg && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
