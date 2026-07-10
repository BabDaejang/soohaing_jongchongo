"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runMatching, type MatchingSummary } from "@/app/projects/[id]/submissions/actions";

// runMatching의 LLM_BUDGET_PER_RUN과 맞춘 안내용 값 (서버 상수를 클라이언트로 끌어오지 않는다).
const LLM_NOTE = 20;

// 매칭 실행 (SPEC 5.2). 명단과 모호하지 않게 일치하면 자동, 애매하면 확인 대기 큐로.
export function MatchingPanel({
  projectId,
  unmatchedCount,
}: {
  projectId: string;
  unmatchedCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState<MatchingSummary | null>(null);
  const [error, setError] = useState("");

  const run = () =>
    start(async () => {
      setError("");
      try {
        const s = await runMatching(projectId);
        setSummary(s);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "매칭 실패");
      }
    });

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-zinc-600 dark:text-zinc-300">
          미매칭 제출물 <b>{unmatchedCount}</b>건.
          <span className="ml-1 text-xs text-zinc-400">
            학번이 일치하거나 이름이 명단에 한 명뿐이면 자동 귀속합니다. 파일명에서 못 찾으면
            문서 내용을 읽어 추정하고, 동명이인·식별 불가는 확인 대기 큐로 보냅니다.
          </span>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending || unmatchedCount === 0}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "매칭 중…" : "매칭 실행"}
        </button>
      </div>
      {summary && (
        <div className="mt-2 text-sm text-zinc-500">
          <p>
            자동 귀속 <b>{summary.autoNumber + summary.autoName}</b>건 (학번 일치{" "}
            {summary.autoNumber} · 이름 유일 일치 {summary.autoName} · 신규 학생{" "}
            {summary.newStudents}) · 확인 대기 <b>{summary.pending}</b>건
          </p>
          {(summary.fromFilename > 0 || summary.fromLlm > 0) && (
            <p className="mt-1 text-xs text-zinc-400">
              식별값 출처 — 파일명 {summary.fromFilename}건 · LLM 추출 {summary.fromLlm}건.
              자동 귀속 결과는 아래 학생별 제출물에서 배지로 확인하고, 틀렸다면 [다른 학생으로
              이동]으로 바로잡으세요.
            </p>
          )}
          {summary.llmRemaining > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              LLM 추출은 한 번에 {LLM_NOTE}건까지만 처리합니다. {summary.llmRemaining}건이 남아
              있으니 [매칭 실행]을 다시 눌러 주세요.
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
