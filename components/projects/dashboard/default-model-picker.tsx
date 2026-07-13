"use client";

import { useMemo, useState, useTransition } from "react";
import {
  saveDefaultModel,
  applyDefaultToAllRouting,
  type DiffingRouting,
} from "@/app/projects/[id]/dashboard-actions";
import { VISION_MODELS } from "@/lib/llm/vision-models";
import type { RoutableProvider } from "@/lib/llm/available";
import type { ModelRouting, RoutingKey } from "@/lib/llm/types";

const CUSTOM = "__custom__";

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const PURPOSE_LABELS: Record<RoutingKey, string> = {
  extract: "추출·매칭",
  evaluate: "평가",
  generate: "생성",
  verify: "검증",
};
const PURPOSE_ORDER: RoutingKey[] = ["extract", "evaluate", "generate", "verify"];

// 키에 저장된 모델 목록을 쓰되, 0010 이전에 등록된 키는 비어 있으므로 정적 카탈로그로 폴백한다.
function modelOptions(provider: RoutableProvider | undefined): string[] {
  if (!provider) return [];
  if (provider.models.length > 0) return provider.models;
  return VISION_MODELS[provider.api_format] ?? [];
}

export function DefaultModelPicker({
  projectId,
  routing,
  providers,
}: {
  projectId: string;
  routing: ModelRouting;
  providers: RoutableProvider[];
}) {
  // 쓸 수 있는 키가 있는 프로바이더만 기본 모델 대상이다 (SPEC 3절).
  const usable = useMemo(
    () => providers.filter((p) => p.keySource !== null),
    [providers],
  );
  const nameById = useMemo(
    () => new Map(providers.map((p) => [p.id, p.name])),
    [providers],
  );

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [differing, setDiffering] = useState<DiffingRouting[] | null>(null);

  const initialProvider = usable.some((p) => p.id === routing.default?.provider_id)
    ? routing.default!.provider_id
    : (usable[0]?.id ?? "");
  const initialOptions = modelOptions(usable.find((p) => p.id === initialProvider));
  const initialInCatalog = routing.default?.model
    ? initialOptions.includes(routing.default.model)
    : false;

  const [provider, setProviderState] = useState(initialProvider);
  const [choice, setChoice] = useState(
    initialInCatalog ? routing.default!.model : CUSTOM,
  );
  const [custom, setCustom] = useState(
    initialInCatalog ? "" : (routing.default?.model ?? ""),
  );

  const options = modelOptions(usable.find((p) => p.id === provider));
  const staleCatalog =
    usable.find((p) => p.id === provider)?.models.length === 0;
  const model = choice === CUSTOM ? custom.trim() : choice;
  const noUsable = usable.length === 0;

  function setProvider(id: string) {
    const first = modelOptions(usable.find((p) => p.id === id))[0];
    setProviderState(id);
    setChoice(first ?? CUSTOM);
    setCustom("");
  }

  function onSave() {
    setError(null);
    setDiffering(null);
    startTransition(async () => {
      try {
        const res = await saveDefaultModel(projectId, provider, model);
        setDiffering(res.differing);
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
      }
    });
  }

  function onApplyAll() {
    setError(null);
    startTransition(async () => {
      try {
        await applyDefaultToAllRouting(projectId);
        setDiffering([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "교체에 실패했습니다.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <div>
        <h3 className="text-sm font-semibold">기본 AI 모델</h3>
        <p className="mt-1 text-xs text-zinc-500">
          수합 OCR·평가·생기부에 공통으로 쓸 기본 모델입니다. 용도별 세부 지정은
          프로젝트 설정의 모델 라우팅에서 조정할 수 있습니다.
        </p>
      </div>

      {noUsable ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          등록된 API 키가 없어 기본 모델을 선택할 수 없습니다. 위에서 개인 키를
          먼저 등록하세요.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={pending}
            className={selectClass}
          >
            {usable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={pending}
            className={selectClass}
          >
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM}>직접 입력…</option>
          </select>

          {choice === CUSTOM && (
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              disabled={pending}
              placeholder="모델 ID"
              className={`${selectClass} min-w-52 flex-1`}
            />
          )}

          <button
            type="button"
            onClick={onSave}
            disabled={pending || !provider || !model}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            {pending ? "저장 중…" : "기본 모델로 저장"}
          </button>
        </div>
      )}

      {!noUsable && staleCatalog && (
        <p className="text-xs text-zinc-400">
          모델 목록이 비어 있습니다. 계정 옵션에서 [모델 갱신]을 눌러 주세요.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {/* 저장 성공 후 다른 페이즈에 개별 모델이 있으면 교체를 묻는다(사용자 지시). */}
      {differing && differing.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-3 text-xs dark:border-sky-800 dark:bg-sky-950">
          <p className="text-sky-900 dark:text-sky-200">
            다른 페이즈에 개별 선택된 모델이 있습니다:
          </p>
          <ul className="ml-4 list-disc text-sky-800 dark:text-sky-300">
            {differing.map((d) => (
              <li key={d.key}>
                {d.label}: {d.providerName} · {d.model}
              </li>
            ))}
          </ul>
          <p className="text-sky-900 dark:text-sky-200">
            전부 기본 AI 모델로 교체할까요?
          </p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onApplyAll}
              disabled={pending}
              className="rounded-md bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-600 disabled:opacity-60"
            >
              {pending ? "교체 중…" : "전부 교체"}
            </button>
            <button
              type="button"
              onClick={() => setDiffering(null)}
              disabled={pending}
              className="rounded-md border border-sky-300 px-3 py-1.5 text-sky-800 hover:bg-sky-100 disabled:opacity-60 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900"
            >
              개별 설정 유지
            </button>
          </div>
        </div>
      )}

      {differing && differing.length === 0 && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          저장되었습니다.
        </p>
      )}

      {/* 현재 기본값과 4개 용도 요약(항상 표시) */}
      <div className="border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
        <p>
          현재 기본 AI 모델:{" "}
          {routing.default ? (
            <span className="font-medium text-zinc-700 dark:text-zinc-200">
              {nameById.get(routing.default.provider_id) ??
                routing.default.provider_id}{" "}
              · {routing.default.model}
            </span>
          ) : (
            <span className="italic">미설정</span>
          )}
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          {PURPOSE_ORDER.map((key) => {
            const t = routing[key];
            return (
              <li key={key}>
                {PURPOSE_LABELS[key]}:{" "}
                {t
                  ? `${nameById.get(t.provider_id) ?? t.provider_id} · ${t.model}`
                  : "미설정"}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
