"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  prepareSourceIdentify,
  identifySourceOne,
  prepareFactsheetStage,
  prepareFactsheetOne,
  prepareAuthenticity,
  verifyAuthenticityOne,
  prepareEvaluation,
  evaluateOne,
  finalizeEvaluation,
  recalculate,
  updateGradingScheme,
} from "@/app/projects/[id]/evaluate/actions";
import { createClient } from "@/lib/supabase/client";
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

// 페이즈 2 · 평가 (리팩토링 2 배치 7·10). 실행은 2스테이지 연쇄다:
//   스테이지 A = 진실성 검증(채점 앞) → nextStage → 스테이지 B = 채점(기존).
// 진실성은 채점 프롬프트·감점 로직에 섞지 않는다(의심이어도 채점 진행 — 플래그만, 배치 10).
// 채점 1건마다 작업결과표를 갱신하되, 확정 표시 점수는 finalize의 재계산 후 나온다(배치 2 설계).
export function Phase2Panel({
  projectId,
  needsRecalc,
  matchedIncluded,
  scoredSubmissions,
  suspectCount,
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
  suspectCount: number; // 진실성 '의심' 제출물 수(플래그만)
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
  const [concurrency, setConcurrency] = useState(2);
  const [, startScheme] = useTransition();

  // S1 (식별)
  const s1SkippedRef = useRef(0);
  const s1TallyRef = useRef({ book: 0, web: 0, none: 0, isbnConfirm: 0 });

  const s1Prepare = useCallback(async () => {
    const { targets, skipped } = await prepareSourceIdentify(projectId);
    s1SkippedRef.current = skipped;
    s1TallyRef.current = { book: 0, web: 0, none: 0, isbnConfirm: 0 };
    return {
      targets,
      prelude: [
        {
          level: "info" as const,
          text: `식별 대상 ${targets.length}건 · 증분 보존 ${skipped}건`,
        },
      ],
    };
  }, [projectId]);

  const s1StepOne = useCallback(
    async (t: SequentialTarget) => {
      const r = await identifySourceOne(projectId, t.id);
      if (r.ok && r.info) {
        s1TallyRef.current[r.info.kind] += 1;
        if (r.info.isbnConfirmed) s1TallyRef.current.isbnConfirm += 1;
      }
      return { ok: r.ok, message: r.message, retryable: r.retryable };
    },
    [projectId],
  );

  const s1Finalize = useCallback(async () => {
    const t = s1TallyRef.current;
    return `식별 — 도서 ${t.book}·URL ${t.web}·해당 없음 ${t.none}·ISBN 확정 ${t.isbnConfirm}`;
  }, []);

  // S2 (팩트시트 준비)
  const s2TallyRef = useRef({ reuse: 0, create: 0, fail: 0 });

  const s2Prepare = useCallback(async () => {
    const { targets, prelude } = await prepareFactsheetStage(projectId);
    s2TallyRef.current = { reuse: 0, create: 0, fail: 0 };
    return { targets, prelude };
  }, [projectId]);

  const s2StepOne = useCallback(
    async (t: SequentialTarget) => {
      const r = await prepareFactsheetOne(projectId, t.id);
      if (r.ok && r.info?.status) {
        s2TallyRef.current[r.info.status] += 1;
      } else if (!r.ok) {
        s2TallyRef.current.fail += 1;
      }
      return { ok: r.ok, message: r.message, retryable: r.retryable };
    },
    [projectId],
  );

  const s2Finalize = useCallback(async () => {
    const t = s2TallyRef.current;
    return `팩트시트 — 재사용 ${t.reuse}·생성 ${t.create}·실패 ${t.fail}`;
  }, []);

  // S3 (대조)
  const authSkippedRef = useRef(0);
  const authTallyRef = useRef({
    verified: 0,
    suspect: 0,
    unverifiable: 0,
    not_applicable: 0,
  });

  const authPrepare = useCallback(async () => {
    const { targets, skipped } = await prepareAuthenticity(projectId);
    authSkippedRef.current = skipped;
    authTallyRef.current = {
      verified: 0,
      suspect: 0,
      unverifiable: 0,
      not_applicable: 0,
    };
    return {
      targets,
      prelude: [
        {
          level: "info" as const,
          text: `진실성 검증 대상 ${targets.length}건 · 증분 보존 ${skipped}건`,
        },
      ],
    };
  }, [projectId]);

  const authStepOne = useCallback(
    async (t: SequentialTarget) => {
      const r = await verifyAuthenticityOne(projectId, t.id);
      const s = r.status;
      if (r.ok && s && s !== "unverified") {
        authTallyRef.current[s as keyof typeof authTallyRef.current] += 1;
      }
      emitWorksheetRefresh(); // 1건마다 작업결과표 갱신(제출물 배지 반영)
      return { ok: r.ok, message: r.message, retryable: r.retryable };
    },
    [projectId],
  );

  const authFinalize = useCallback(async () => {
    const supabase = createClient();
    const { data: allSubs } = await supabase
      .from("submissions")
      .select("authenticity_status")
      .eq("project_id", projectId)
      .eq("include_in_eval", true)
      .not("student_id", "is", null)
      .in("match_status", ["auto_matched", "confirmed"]);

    const t = { verified: 0, suspect: 0, unverifiable: 0, not_applicable: 0, unverified: 0 };
    for (const s of allSubs ?? []) {
      const status = s.authenticity_status;
      if (status in t) {
        t[status as keyof typeof t] += 1;
      }
    }
    return `진실성 요약 — 확인 ${t.verified}·의심 ${t.suspect}·판정 불가 ${t.unverifiable}·해당 없음 ${t.not_applicable}·증분 보존 ${authSkippedRef.current}`;
  }, [projectId]);

  // S4 (채점)
  const skippedRef = useRef(0);
  const sampleFailureRef = useRef<string | null>(null);

  const evalPrepare = useCallback(async () => {
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

  const evalStepOne = useCallback(
    async (t: SequentialTarget) => {
      const r = await evaluateOne(projectId, t.id);
      if (!r.ok && !sampleFailureRef.current) sampleFailureRef.current = r.message;
      emitWorksheetRefresh(); // 1건마다 작업결과표 갱신(제출물 채점 반영)
      return { ok: r.ok, message: r.message, retryable: r.retryable };
    },
    [projectId],
  );

  const evalFinalize = useCallback(
    async ({
      succeeded,
      failed,
      aborted,
    }: {
      succeeded: number;
      failed: number;
      aborted: boolean;
    }) => {
      const { ranked, pendingConfirm, respread } = await finalizeEvaluation(
        projectId,
        { scored: succeeded, failed, skipped: skippedRef.current },
        aborted,
        sampleFailureRef.current ?? undefined,
      );
      // 확정 표시 점수·등급은 finalize 재계산 후 나온다 — 재계산 후 한 번 더 갱신한다.
      emitWorksheetRefresh();
      router.refresh();
      const baseMsg = pendingConfirm
        ? `채점 ${pendingConfirm.scored}/${pendingConfirm.required}명 — 표시 점수 확정 대기(최소 ${pendingConfirm.required}명 채점 후 확정)`
        : `재계산 — ${ranked}명 순위 산출`;
      return respread
        ? `${baseMsg}\n⚠ 표시 점수 전체 재배치 발생 — 기존 배정이 재스프레드되었습니다(빈도 계측 중)`
        : baseMsg;
    },
    [projectId, router],
  );

  // 스테이지 연쇄: S1 -> S2 -> S3 -> S4
  const nextStage3To4 = useCallback(
    () => ({ prepare: evalPrepare, stepOne: evalStepOne, finalize: evalFinalize }),
    [evalPrepare, evalStepOne, evalFinalize],
  );

  const nextStage2To3 = useCallback(
    () => ({ prepare: authPrepare, stepOne: authStepOne, finalize: authFinalize, nextStage: nextStage3To4 }),
    [authPrepare, authStepOne, authFinalize, nextStage3To4],
  );

  const nextStage1To2 = useCallback(
    () => ({ prepare: s2Prepare, stepOne: s2StepOne, finalize: s2Finalize, nextStage: nextStage2To3 }),
    [s2Prepare, s2StepOne, s2Finalize, nextStage2To3],
  );

  const { lines, runState, progress, start, pause, resume, stop } =
    useSequentialRun({
      prepare: s1Prepare,
      stepOne: s1StepOne,
      finalize: s1Finalize,
      nextStage: nextStage1To2,
      concurrency,
    });

  const running =
    runState === "running" || runState === "paused" || runState === "stopping";

  function recalc() {
    setError(null);
    setMsg(null);
    startRecalc(async () => {
      try {
        const { ranked, pendingConfirm, respread } = await recalculate(projectId);
        const baseMsg = pendingConfirm
          ? `채점 ${pendingConfirm.scored}/${pendingConfirm.required}명 — 표시 점수 확정 대기(최소 ${pendingConfirm.required}명 채점 후 확정)`
          : `재계산 완료 — ${ranked}명 순위 산출`;
        setMsg(
          respread
            ? `${baseMsg}\n⚠ 표시 점수 전체 재배치 발생 — 기존 배정이 재스프레드되었습니다(빈도 계측 중)`
            : baseMsg,
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

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={start}
              disabled={running || recalcPending}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              {running ? "실행 중…" : "채점 실행"}
            </button>
            <button
              type="button"
              onClick={recalc}
              disabled={recalcPending || running}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              재계산
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="concurrency-select" className="text-zinc-500 font-medium">
              동시 처리:
            </label>
            <select
              id="concurrency-select"
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              disabled={running}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value={1}>1건씩</option>
              <option value={2}>2건씩 (기본)</option>
              <option value={3}>3건씩</option>
            </select>
            <span className="text-[11px] text-zinc-400">
              (API 키 등급이 낮아 요청 제한(429)이 잦으면 1건을 권장합니다)
            </span>
          </div>

          {needsRecalc && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              ● 재계산 필요
            </span>
          )}
          <Link
            href="/factsheets"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            도서팩트시트 →
          </Link>
        </div>

        {suspectCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
              ⚠ 진실성 의심 {suspectCount}건
            </span>
            <Link
              href={`/projects/${projectId}/submissions`}
              className="text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              제출물 상세에서 근거 보기 →
            </Link>
            <span className="text-zinc-400">
              의심은 플래그일 뿐 — 채점은 진행됩니다(자동 감점·제외 없음).
            </span>
          </div>
        )}

        <p className="text-xs text-zinc-500">
          [채점 실행]은 <b>진실성 검증 → 채점</b> 순으로 진행됩니다. 진실성 검증은 인용 출처를
          식별해 도서팩트시트·인용 URL 원문과 대조하며(의심이어도 채점은 진행), 이어서 채점
          스테이지가 실행됩니다. 채점 대상(반영 체크 + 매칭 확정) 제출물 {matchedIncluded}건 중{" "}
          {scoredSubmissions}건 채점됨
          {pendingCount > 0 && ` · 미채점 ${pendingCount}건`}. 두 스테이지 모두 건별로 실행되며
          진행 중 일시정지·재개·긴급 중단할 수 있고, 중단해도 처리분은 반영됩니다. temperature를
          지원하는 모델은 0으로 고정하며(gpt-5 계열 미지원), 내용이 바뀌지 않은 제출물은
          재검증·재채점하지 않습니다(증분). 표시 점수는 초기 확정 인원(15~25명) 채점 후 999점
          만점으로 확정됩니다.
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
