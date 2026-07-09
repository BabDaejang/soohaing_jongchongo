"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runMatching, type MatchingSummary } from "@/app/projects/[id]/submissions/actions";

// 매칭 실행 (SPEC 5.2). 학번 일치만 자동, 나머지는 확인 대기 큐로.
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
            학번이 있으면 자동 귀속, 이름만/식별 불가는 확인 대기 큐로 보냅니다.
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
        <p className="mt-2 text-sm text-zinc-500">
          자동 귀속 <b>{summary.autoMatched}</b> (신규 학생 {summary.newStudents}) ·
          이름 확인 대기 <b>{summary.pendingName}</b> · 식별 불가 대기{" "}
          <b>{summary.pendingNone}</b>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
