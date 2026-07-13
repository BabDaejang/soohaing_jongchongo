"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  prepareRecordRun,
  generateRecord,
} from "@/app/projects/[id]/records/actions";
import { applyRecommendedGenerate } from "@/app/projects/[id]/dashboard-actions";
import {
  useSequentialRun,
  type SequentialTarget,
} from "@/lib/hooks/use-sequential-run";
import { RunTerminal } from "@/components/projects/run-terminal";
import { emitWorksheetRefresh } from "@/lib/worksheet/refresh";
import { recommendCostEffective, type ModelCandidate } from "@/lib/llm/recommend";
import type { RoutableProvider } from "@/lib/llm/available";
import type { ModelRouting } from "@/lib/llm/types";

// 페이즈 3 · 생기부 (리팩토링 2 배치 7). 일괄 생성을 실행 터미널로(학생 1명=호출 1회, INV-1).
// 내보내기는 아래 작업결과표의 [다운로드]를 쓴다(중복 구현 금지).
export function Phase3Panel({
  projectId,
  routing,
  providers,
}: {
  projectId: string;
  routing: ModelRouting;
  providers: RoutableProvider[];
}) {
  const router = useRouter();
  const [applyPending, startApply] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);

  const nameById = useMemo(
    () => new Map(providers.map((p) => [p.id, p.name])),
    [providers],
  );
  const usableIds = useMemo(
    () => new Set(providers.filter((p) => p.keySource !== null).map((p) => p.id)),
    [providers],
  );

  const genTarget = routing.generate;
  const verTarget = routing.verify;
  const genName = nameById.get(genTarget?.provider_id ?? "") ?? "알 수 없음";
  const verName = nameById.get(verTarget?.provider_id ?? "") ?? "알 수 없음";

  // generate가 키 없는 프로바이더를 가리키거나 미설정이면 가성비 추천을 띄운다.
  const generateUsable = !!genTarget && usableIds.has(genTarget.provider_id);
  const recommendation = useMemo(() => {
    const candidates: ModelCandidate[] = providers
      .filter((p) => p.keySource !== null)
      .flatMap((p) =>
        p.models.map((model) => ({
          providerId: p.id,
          providerName: p.name,
          model,
        })),
      );
    return recommendCostEffective(candidates);
  }, [providers]);
  const showRecommend = !generateUsable && recommendation !== null;

  // ── 일괄 생성 실행(학생별 순차 단일 호출) ──────────────────────────────
  const prepare = useCallback(async () => {
    const { targets } = await prepareRecordRun(projectId);
    return {
      targets,
      prelude: [
        { level: "info" as const, text: `생성 대상 ${targets.length}명` },
      ],
    };
  }, [projectId]);

  const stepOne = useCallback(
    async (t: SequentialTarget) => {
      try {
        const r = await generateRecord(projectId, t.id);
        emitWorksheetRefresh(); // 1건마다 작업결과표 생기부 열 갱신
        return {
          ok: true,
          message: `v${r.version} 생성·검증 완료(미근거 ${r.unsupported}문장)`,
        };
      } catch (e) {
        const m = e instanceof Error ? e.message : "생성 실패";
        return { ok: false, message: m.slice(0, 300) };
      }
    },
    [projectId],
  );

  const finalize = useCallback(
    async ({ succeeded, failed }: { succeeded: number; failed: number }) => {
      router.refresh();
      return `일괄 생성 완료 — 성공 ${succeeded}·실패 ${failed}`;
    },
    [router],
  );

  const { lines, runState, progress, start, pause, resume, stop } =
    useSequentialRun({ prepare, stepOne, finalize });

  const running =
    runState === "running" || runState === "paused" || runState === "stopping";

  function onApplyRecommend() {
    setApplyError(null);
    startApply(async () => {
      try {
        await applyRecommendedGenerate(projectId);
        router.refresh();
      } catch (e) {
        setApplyError(e instanceof Error ? e.message : "적용에 실패했습니다.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ① 실행 컨트롤 행 */}
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            생성: {genName} / {genTarget?.model ?? "미설정"} · 검증: {verName} /{" "}
            {verTarget?.model ?? "미설정"}
          </span>
          {showRecommend && recommendation && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
              추천: {recommendation.providerName} / {recommendation.model} (가격 대비 성능)
            </span>
          )}
          {showRecommend && (
            <button
              type="button"
              onClick={onApplyRecommend}
              disabled={applyPending}
              className="rounded-md border border-sky-300 px-2.5 py-1 font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-60 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950"
            >
              {applyPending ? "적용 중…" : "적용"}
            </button>
          )}
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
            disabled={running}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            {running ? "생성 중…" : "생기부 일괄 생성"}
          </button>
          {progress && running && (
            <span className="text-xs font-medium text-zinc-500">
              진행 {progress.done}/{progress.total}
            </span>
          )}
        </div>

        <p className="text-xs text-zinc-500">
          반영된 제출물·교사 메모가 있는 학생만 대상입니다. 학생 한 명씩 격리 생성하며(INV-1),
          진행 중 일시정지·재개·긴급 중단할 수 있습니다. 1건마다 작업결과표가 갱신됩니다.
        </p>
        {applyError && <p className="text-xs text-red-600">{applyError}</p>}
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

      {/* ③ 세부 화면 링크 카드 */}
      <div className="flex flex-col gap-3">
        <LinkCard
          href={`/projects/${projectId}/profile`}
          title="프롬프트 프로필 →"
          desc="생기부 작성 참고·금지사항(계정 기본+오버라이드)"
        />
        <LinkCard
          href={`/projects/${projectId}/records`}
          title="학생별 상세·문장 검증 →"
          desc="생기부 생성·편집·근거 검증·버전 이력"
        />
      </div>

      {/* ④ 내보내기 안내 */}
      <p className="text-xs text-zinc-400">
        생기부 내보내기(xlsx/csv/md, 전체/선택)는 아래{" "}
        <a href="#worksheet" className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300">
          작업결과표
        </a>
        의 [다운로드]를 사용하세요.
      </p>
    </div>
  );
}

function LinkCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
    >
      <span className="font-medium">{title}</span>
      <span className="mt-1 text-xs text-zinc-500">{desc}</span>
    </Link>
  );
}
