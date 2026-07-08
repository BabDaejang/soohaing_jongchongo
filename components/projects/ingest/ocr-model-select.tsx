"use client";

import { useMemo, useState, useTransition } from "react";
import { saveOcrModel } from "@/app/projects/[id]/ingest/actions";
import { VISION_MODELS } from "@/lib/llm/vision-models";
import type { ApiFormat } from "@/lib/supabase/types";
import type { ModelTarget } from "@/lib/llm";

// extract 라우팅 값 = {provider_id, model}.
type Extract = ModelTarget;

type ProviderOpt = { id: string; name: string; api_format: ApiFormat };

const CUSTOM = "__custom__";
const inputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

// OCR(추출) 담당 프로바이더·모델 선택 (세션 5). 프로젝트 model_routing.extract에 저장된다.
export function OcrModelSelect({
  projectId,
  providers,
  extract,
}: {
  projectId: string;
  providers: ProviderOpt[];
  extract: Extract;
}) {
  const [providerId, setProviderId] = useState(
    providers.some((p) => p.id === extract.provider_id)
      ? extract.provider_id
      : (providers[0]?.id ?? ""),
  );
  const provider = providers.find((p) => p.id === providerId);
  const catalog: string[] = provider ? VISION_MODELS[provider.api_format] : [];

  const initialModelInCatalog = catalog.includes(extract.model);
  const [modelChoice, setModelChoice] = useState(
    initialModelInCatalog ? extract.model : CUSTOM,
  );
  const [customModel, setCustomModel] = useState(
    initialModelInCatalog ? "" : extract.model,
  );
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const model = modelChoice === CUSTOM ? customModel.trim() : modelChoice;

  const currentLabel = useMemo(() => {
    const name = providers.find((p) => p.id === extract.provider_id)?.name ?? "?";
    return `${name} / ${extract.model}`;
  }, [providers, extract]);

  const onProviderChange = (id: string) => {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    const first = p ? (VISION_MODELS[p.api_format][0] ?? CUSTOM) : CUSTOM;
    setModelChoice(first);
    setSaved(false);
  };

  const apply = () => {
    if (!providerId || !model) return;
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("providerId", providerId);
    fd.set("model", model);
    startTransition(async () => {
      await saveOcrModel(fd);
      setSaved(true);
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        회사(프로바이더)
        <select
          value={providerId}
          onChange={(e) => onProviderChange(e.target.value)}
          className={inputClass}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        OCR 모델
        <select
          value={modelChoice}
          onChange={(e) => {
            setModelChoice(e.target.value);
            setSaved(false);
          }}
          className={inputClass}
        >
          {catalog.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
          <option value={CUSTOM}>직접 입력…</option>
        </select>
      </label>
      {modelChoice === CUSTOM && (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          모델명 직접 입력
          <input
            value={customModel}
            onChange={(e) => {
              setCustomModel(e.target.value);
              setSaved(false);
            }}
            placeholder="예: gpt-4o"
            className={inputClass}
          />
        </label>
      )}
      <button
        type="button"
        onClick={apply}
        disabled={pending || !model}
        className="rounded-md bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? "저장 중…" : "적용"}
      </button>
      <span className="text-xs text-zinc-400">
        {saved ? "저장됨 · " : ""}현재: {currentLabel}
      </span>
    </div>
  );
}
