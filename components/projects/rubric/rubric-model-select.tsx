"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRubricModel } from "@/app/projects/[id]/rubric/actions";
import { VISION_MODELS } from "@/lib/llm/vision-models";
import type { RoutableProvider } from "@/lib/llm/available";
import type { ModelRouting } from "@/lib/llm/types";

const CUSTOM = "__custom__";

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

// 키에 저장된 모델 목록을 쓰되, 0010 이전 키는 비어 있으므로 정적 카탈로그로 폴백한다.
function modelOptions(provider: RoutableProvider | undefined): string[] {
  if (!provider) return [];
  if (provider.models.length > 0) return provider.models;
  return VISION_MODELS[provider.api_format] ?? [];
}

// 루브릭 전담 모델 선택 (리팩토링 2 배치 7). 평가계획서 AI 분석에 쓰는 모델을 정한다.
// 적용 폴백 순서: rubric ?? default ?? evaluate. 페이즈 0 기본 모델 피커와 동일 패턴.
export function RubricModelSelect({
  projectId,
  routing,
  providers,
}: {
  projectId: string;
  routing: ModelRouting;
  providers: RoutableProvider[];
}) {
  const router = useRouter();
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
  const [saved, setSaved] = useState(false);

  const initialProvider = usable.some((p) => p.id === routing.rubric?.provider_id)
    ? routing.rubric!.provider_id
    : (usable[0]?.id ?? "");
  const initialOptions = modelOptions(usable.find((p) => p.id === initialProvider));
  const initialInCatalog = routing.rubric?.model
    ? initialOptions.includes(routing.rubric.model)
    : false;

  const [provider, setProviderState] = useState(initialProvider);
  const [choice, setChoice] = useState(
    initialInCatalog ? routing.rubric!.model : CUSTOM,
  );
  const [custom, setCustom] = useState(
    initialInCatalog ? "" : (routing.rubric?.model ?? ""),
  );

  const options = modelOptions(usable.find((p) => p.id === provider));
  const staleCatalog = usable.find((p) => p.id === provider)?.models.length === 0;
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
    setSaved(false);
    startTransition(async () => {
      try {
        await saveRubricModel(projectId, provider, model);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
      }
    });
  }

  // 적용 모델(폴백 순서): rubric ?? default ?? evaluate.
  const applied = routing.rubric ?? routing.default ?? routing.evaluate;
  const appliedSource = routing.rubric
    ? "rubric"
    : routing.default
      ? "default"
      : "evaluate";

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <div>
        <h3 className="text-sm font-semibold">루브릭 전담 모델</h3>
        <p className="mt-1 text-xs text-zinc-500">
          평가계획서 AI 분석에 쓰는 모델입니다. 미설정 시 기본 AI 모델 → 평가 모델 순으로
          폴백합니다(rubric → default → evaluate).
        </p>
      </div>

      {noUsable ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          등록된 API 키가 없어 전담 모델을 선택할 수 없습니다. 페이즈 0에서 키를 먼저
          등록하세요.
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
            {pending ? "저장 중…" : "전담 모델로 저장"}
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
      {saved && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">저장되었습니다.</p>
      )}

      <div className="border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
        현재 적용 모델:{" "}
        {applied ? (
          <span className="font-medium text-zinc-700 dark:text-zinc-200">
            {nameById.get(applied.provider_id) ?? applied.provider_id} ·{" "}
            {applied.model}
          </span>
        ) : (
          <span className="italic">미설정</span>
        )}{" "}
        <span className="text-zinc-400">({appliedSource} 키에서)</span>
      </div>
    </div>
  );
}
