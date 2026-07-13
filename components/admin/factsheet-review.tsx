"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveFactsheet,
  finalizeStrictReview,
  prepareStrictReview,
  rejectFactsheet,
  reviewEntryStrictAction,
  unshareFactsheet,
} from "@/app/admin/actions";
import {
  useSequentialRun,
  type SequentialTarget,
} from "@/lib/hooks/use-sequential-run";
import { RunTerminal } from "@/components/projects/run-terminal";
import type { RoutableProvider } from "@/lib/llm/available";
import type { EntryReview } from "@/lib/factsheet/strict-review";
import type { FactsheetSourceType } from "@/lib/supabase/types";

// 팩트시트 공유 승인 + AI 엄격 검증 (리팩토링 2 배치 11). 관리자 전용 섹션.
// 서버 액션(requireAdmin)만 호출하고, 모델은 관리자 본인의 키 보유 프로바이더에서 고른다.

export type ReviewReport = {
  summary?: { pass: number; fail: number; unfetchable: number };
  metaCheck?: { status: string; note: string };
  model?: string;
  reviewed_at?: string;
  rejected_reason?: string;
  rejected_at?: string;
};

export type ReviewEntryInfo = {
  id: string;
  chapterLabel: string;
  content: string;
  quote: string | null;
  sourceUrl: string | null;
  sourceType: FactsheetSourceType;
};

export type PendingItem = {
  id: string;
  title: string;
  author: string | null;
  isbn13: string | null;
  createdAt: string;
  ownerEmail: string;
  review: ReviewReport | null;
  entries: ReviewEntryInfo[];
};

export type SharedItem = {
  id: string;
  title: string;
  author: string | null;
  ownerEmail: string;
  reviewedAt: string | null;
  entryCount: number;
  review: ReviewReport | null;
};

const SOURCE_LABEL: Record<FactsheetSourceType, string> = {
  aladin: "알라딘",
  naver_book: "네이버 책",
  naver_blog: "네이버 블로그",
  naver_news: "네이버 뉴스",
  web: "웹",
  user_upload: "촬영본",
  user_manual: "직접 입력",
};

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const CUSTOM = "__custom__";

export function FactsheetReview({
  pending,
  shared,
  providers,
}: {
  pending: PendingItem[];
  shared: SharedItem[];
  providers: RoutableProvider[];
}) {
  const [tab, setTab] = useState<"queue" | "shared">("queue");

  // 검증 모델 선택(관리자 본인 키). 재검증·승인 큐 카드가 공유한다.
  const [providerId, setProviderId] = useState(
    () => providers.find((p) => p.keySource !== null)?.id ?? providers[0]?.id ?? "",
  );
  const provider = providers.find((p) => p.id === providerId);
  const catalog = useMemo(() => provider?.models ?? [], [provider]);
  const [modelChoice, setModelChoice] = useState("");
  const [customModel, setCustomModel] = useState("");
  const effectiveModel =
    (modelChoice || catalog[0] || CUSTOM) === CUSTOM
      ? customModel.trim()
      : modelChoice || catalog[0] || "";
  const noKey = provider?.keySource === null || !provider;
  const disabled = noKey || !effectiveModel;

  const tabBtn = (key: "queue" | "shared", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        tab === key
          ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 검증 모델 선택 */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          검증 회사(프로바이더)
          <select
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setModelChoice("");
            }}
            className={inputClass}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={p.keySource === null}>
                {p.name}
                {p.keySource === null ? " (키 없음)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          검증 모델
          <select
            value={modelChoice || catalog[0] || CUSTOM}
            onChange={(e) => setModelChoice(e.target.value)}
            className={inputClass}
            disabled={noKey}
          >
            {catalog.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM}>직접 입력…</option>
          </select>
        </label>
        {(modelChoice || catalog[0] || CUSTOM) === CUSTOM && (
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            모델명
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="예: gpt-4o-mini"
              className={inputClass}
              disabled={noKey}
            />
          </label>
        )}
        {noKey && (
          <p className="w-full text-xs text-amber-600 dark:text-amber-500">
            이 프로바이더는 등록된 API 키가 없습니다 — 기본 키를 먼저 등록하세요.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {tabBtn("queue", `승인 대기 (${pending.length})`)}
        {tabBtn("shared", `공유됨 (${shared.length})`)}
      </div>

      {tab === "queue" ? (
        pending.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
            승인 대기 중인 팩트시트가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((f) => (
              <PendingCard
                key={f.id}
                item={f}
                providerId={providerId}
                model={effectiveModel}
                disabled={disabled}
              />
            ))}
          </ul>
        )
      ) : shared.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700">
          공유된 팩트시트가 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shared.map((f) => (
            <SharedCard
              key={f.id}
              item={f}
              providerId={providerId}
              model={effectiveModel}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── 저장된 리포트 요약 배지 ───────────────────────────────────────────

function ReportBadges({ review }: { review: ReviewReport | null }) {
  if (!review?.summary) return null;
  const { pass, fail, unfetchable } = review.summary;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
        통과 {pass}
      </span>
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-400">
        실패 {fail}
      </span>
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
        재확인 불가 {unfetchable}
      </span>
      {review.metaCheck && (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          메타 {review.metaCheck.status}
        </span>
      )}
    </div>
  );
}

// ── AI 엄격 검증 터미널(entry 1건 단위) ───────────────────────────────

function StrictReviewRunner({
  factsheetId,
  providerId,
  model,
  disabled,
}: {
  factsheetId: string;
  providerId: string;
  model: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const reviewsRef = useRef<EntryReview[]>([]);
  const providerRef = useRef(providerId);
  const modelRef = useRef(model);

  const prepare = useCallback(() => prepareStrictReview(factsheetId), [factsheetId]);
  const stepOne = useCallback(
    async (t: SequentialTarget) => {
      const r = await reviewEntryStrictAction(
        factsheetId,
        t.id,
        providerRef.current,
        modelRef.current,
      );
      reviewsRef.current.push({ entryId: r.entryId, result: r.result, note: r.note });
      return { ok: r.ok, message: r.message };
    },
    [factsheetId],
  );
  const finalize = useCallback(async () => {
    const msg = await finalizeStrictReview(factsheetId, reviewsRef.current, modelRef.current);
    router.refresh();
    return msg;
  }, [factsheetId, router]);

  const { lines, runState, progress, start, pause, resume, stop } = useSequentialRun({
    prepare,
    stepOne,
    finalize,
  });
  const running =
    runState === "running" || runState === "paused" || runState === "stopping";

  const onRun = () => {
    if (running || disabled) return;
    providerRef.current = providerId;
    modelRef.current = model;
    reviewsRef.current = [];
    start();
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onRun}
        disabled={running || disabled}
        className="self-start rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
      >
        {running ? "검증 중…" : "AI 엄격 검증 실행"}
      </button>
      <RunTerminal
        lines={lines}
        runState={runState}
        progress={progress}
        onPause={pause}
        onResume={resume}
        onStop={stop}
      />
    </div>
  );
}

// ── 승인 대기 카드 ────────────────────────────────────────────────────

function PendingCard({
  item,
  providerId,
  model,
  disabled,
}: {
  item: PendingItem;
  providerId: string;
  model: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const failCount = item.review?.summary?.fail ?? 0;

  function approve() {
    if (
      failCount > 0 &&
      !confirm(`AI 검증에서 실패 ${failCount}건이 있습니다. 그래도 전체 공유를 승인할까요?`)
    ) {
      return;
    }
    setError(null);
    start(async () => {
      try {
        await approveFactsheet(item.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "승인 실패");
      }
    });
  }

  function reject() {
    setError(null);
    start(async () => {
      try {
        await rejectFactsheet(item.id, reason);
        setRejecting(false);
        setReason("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "반려 실패");
      }
    });
  }

  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{item.title}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {[
              item.author ?? "저자 미상",
              item.isbn13 ? `ISBN ${item.isbn13}` : null,
              `항목 ${item.entries.length}`,
              `신청 ${item.createdAt.slice(0, 10)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">신청 교사: {item.ownerEmail}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {open ? "접기" : "메타·항목 열람"}
        </button>
      </div>

      <div className="mt-2">
        <ReportBadges review={item.review} />
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {item.entries.length === 0 ? (
              <li className="text-xs text-zinc-400">항목이 없습니다.</li>
            ) : (
              item.entries.map((e) => (
                <li
                  key={e.id}
                  className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{e.chapterLabel}</span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {SOURCE_LABEL[e.sourceType]}
                    </span>
                    {e.sourceUrl && (
                      <a
                        href={e.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        출처
                      </a>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                    {e.content}
                  </p>
                  {e.quote && (
                    <p className="mt-1 border-l-2 border-zinc-200 pl-2 text-xs italic text-zinc-400 dark:border-zinc-700">
                      “{e.quote}”
                    </p>
                  )}
                </li>
              ))
            )}
          </ul>

          <StrictReviewRunner
            factsheetId={item.id}
            providerId={providerId}
            model={model}
            disabled={disabled}
          />
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
        >
          승인(전체 공유)
        </button>
        {rejecting ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="반려 사유(교사에게 표시)"
              className={`${inputClass} min-w-[12rem] flex-1`}
            />
            <button
              type="button"
              onClick={reject}
              disabled={pending || !reason.trim()}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-60 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
            >
              반려 확정
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            반려
          </button>
        )}
      </div>
    </li>
  );
}

// ── 공유됨 카드 ───────────────────────────────────────────────────────

function SharedCard({
  item,
  providerId,
  model,
  disabled,
}: {
  item: SharedItem;
  providerId: string;
  model: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function unshare() {
    if (!confirm("이 팩트시트의 전체 공유를 철회할까요? 다른 교사가 더는 재사용할 수 없습니다.")) {
      return;
    }
    setError(null);
    start(async () => {
      try {
        await unshareFactsheet(item.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "철회 실패");
      }
    });
  }

  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{item.title}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {[
              item.author ?? "저자 미상",
              `항목 ${item.entryCount}`,
              item.reviewedAt ? `승인 ${item.reviewedAt.slice(0, 10)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">소유 교사: {item.ownerEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {open ? "접기" : "재검증"}
          </button>
          <button
            type="button"
            onClick={unshare}
            disabled={pending}
            className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            공유 철회
          </button>
        </div>
      </div>

      <div className="mt-2">
        <ReportBadges review={item.review} />
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {open && (
        <div className="mt-3">
          <StrictReviewRunner
            factsheetId={item.id}
            providerId={providerId}
            model={model}
            disabled={disabled}
          />
        </div>
      )}
    </li>
  );
}
