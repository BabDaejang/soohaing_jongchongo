"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  prepareEvaluation,
  evaluateOne,
  finalizeEvaluation,
  recalculate,
  updateGradingScheme,
} from "@/app/projects/[id]/evaluate/actions";
import {
  useSequentialRun,
  type SequentialTarget,
} from "@/lib/hooks/use-sequential-run";
import { RunTerminal } from "@/components/projects/run-terminal";
import { emitWorksheetRefresh } from "@/lib/worksheet/refresh";
import { computeStandings, GRADE_BOUNDARIES } from "@/lib/grading";
import type { GradingScheme, TieBreak } from "@/lib/supabase/types";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

// 페이즈 2 · 평가 (리팩토링 2 배치 7). 구 /evaluate 화면의 실행 패널·등급제 토글·등급 분포
// 요약·override 안내를 대시보드로 이식했다. 학생별 점수 표는 작업결과표가 대체한다.
// 채점 1건마다 작업결과표를 갱신하되, 확정 표시 점수는 finalize의 재계산 후 나온다
// (채점 중에는 확정 표시 점수가 없다 — 배치 2 설계).
export function Phase2Panel({
  projectId,
  needsRecalc,
  matchedIncluded,
  scoredSubmissions,
  providerName,
  model,
  criteriaCount,
  gradingScheme,
  tieBreak,
  effectiveScores,
}: {
  projectId: string;
  needsRecalc: boolean;
  matchedIncluded: number; // 채점 대상 제출물 수(반영+매칭)
  scoredSubmissions: number; // 현재 평가가 있는 제출물 수
  providerName: string;
  model: string;
  criteriaCount: number;
  gradingScheme: GradingScheme;
  tieBreak: TieBreak;
  effectiveScores: number[]; // 확정된 학생들의 반영 점수(override ?? display) — 등급 분포용
}) {
  const router = useRouter();
  const [recalcPending, startRecalc] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheme, setScheme] = useState<GradingScheme>(gradingScheme);
  const [, startScheme] = useTransition();

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
      emitWorksheetRefresh(); // 1건마다 작업결과표 갱신(제출물 채점 반영)
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
      // 확정 표시 점수·등급은 finalize 재계산 후 나온다 — 재계산 후 한 번 더 갱신한다.
      emitWorksheetRefresh();
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
        emitWorksheetRefresh();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "재계산 실패");
      }
    });
  }

  function onToggleScheme(next: GradingScheme) {
    if (next === scheme) return;
    setScheme(next); // 즉시 화면 반영(파생)
    startScheme(async () => {
      await updateGradingScheme(projectId, next); // 설정 영속화
      router.refresh();
    });
  }

  // 등급 분포 요약(등급별 인원 + 경계=해당 등급 최저 반영 점수). 등급은 저장값이 아니라
  // effective에서 파생(INV-6) — 배치와 동일 순수 함수라 토글이 재계산 없이 즉시 반영된다.
  const distribution = useMemo(() => {
    const standings = computeStandings(effectiveScores, scheme, tieBreak);
    const count = GRADE_BOUNDARIES[scheme].length;
    const buckets = Array.from({ length: count }, () => ({ n: 0, min: Infinity }));
    effectiveScores.forEach((eff, i) => {
      const b = buckets[standings[i].grade - 1];
      b.n += 1;
      b.min = Math.min(b.min, eff);
    });
    return buckets;
  }, [effectiveScores, scheme, tieBreak]);

  const pendingCount = matchedIncluded - scoredSubmissions;

  return (
    <div className="flex flex-col gap-4">
      {/* ① 실행 컨트롤 행 */}
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
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
      </div>

      {/* ② 실행 터미널 (상시) */}
      <RunTerminal
        lines={lines}
        runState={runState}
        progress={progress}
        onPause={pause}
        onResume={resume}
        onStop={stop}
      />

      {msg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* ③ 등급제 토글 + 등급 분포 요약 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">등급제</span>
          <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
            {(["grade5", "grade9"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onToggleScheme(g)}
                className={`px-3 py-1 ${
                  scheme === g
                    ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                    : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                {g === "grade5" ? "5등급" : "9등급"}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-400">화면 즉시 반영(점수에서 파생)</span>
        </div>

        {effectiveScores.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
            아직 확정된 표시 점수가 없습니다. [채점 실행]으로 제출물을 채점하세요(초기 확정
            인원 채점 후 등급 분포가 나타납니다).
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {distribution.map((b, i) => (
              <div
                key={i}
                className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
              >
                <span className="font-semibold">{i + 1}등급</span>{" "}
                <span className="text-zinc-500">· {b.n}명</span>
                {b.n > 0 && (
                  <span className="text-zinc-400"> · 경계 {fmt(b.min)}점</span>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-zinc-400">
          등급은 점수에서 파생 계산되며 직접 수정하지 않습니다. 교사 개입(점수 보정)은 아래
          작업결과표의 <b>반영 점수</b> 셀에서 사유와 함께 조정하세요.
        </p>
      </div>

      {/* ④ 루브릭 편집 링크 카드 */}
      <Link
        href={`/projects/${projectId}/rubric`}
        className="flex flex-col rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
      >
        <span className="font-medium">평가 루브릭 편집 →</span>
        <span className="mt-1 text-xs text-zinc-500">
          채점 기준·배점·가중치 (현재 {criteriaCount}개 기준) · 전담 모델 · 평가계획서 AI 분석
        </span>
      </Link>
    </div>
  );
}
