"use client";

import { useMemo, useState, useTransition } from "react";
import { saveOcrModel } from "@/app/projects/[id]/ingest/actions";
import { VISION_MODELS } from "@/lib/llm/vision-models";
import { isVisionCapableModel } from "@/lib/llm/vision-capability";
import type { RoutableProvider } from "@/lib/llm/available";
import type { ModelTarget } from "@/lib/llm";

// extract 라우팅 값 = {provider_id, model}.
type Extract = ModelTarget;

const CUSTOM = "__custom__";
const inputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

// OCR(추출) 담당 프로바이더·모델 선택 (리팩토링 2 배치 6 — 동적 드롭다운).
// 프로바이더는 listRoutableProviders 결과(키 보유·저장 모델 포함), 모델 후보는
// 저장 목록 중 비전 가능 모델만. 저장 목록이 비면 VISION_MODELS 정적 카탈로그로 폴백.
export function OcrModelSelect({
  projectId,
  providers,
  extract,
}: {
  projectId: string;
  providers: RoutableProvider[];
  extract: Extract;
}) {
  // 기본 선택: 저장된 extract 프로바이더 → 키 보유 첫 프로바이더 → 첫 프로바이더.
  const [providerId, setProviderId] = useState(() => {
    if (providers.some((p) => p.id === extract.provider_id)) {
      return extract.provider_id;
    }
    return providers.find((p) => p.keySource !== null)?.id ?? providers[0]?.id ?? "";
  });
  const provider = providers.find((p) => p.id === providerId);

  // 모델 후보: 저장 목록 중 비전 가능만. 비면(0010 이전 키) 정적 카탈로그 폴백.
  const { catalog, usingFallback } = useMemo(() => {
    if (!provider) return { catalog: [] as string[], usingFallback: false };
    const stored = provider.models.filter((m) =>
      isVisionCapableModel(provider.api_format, m),
    );
    if (stored.length > 0) return { catalog: stored, usingFallback: false };
    return { catalog: VISION_MODELS[provider.api_format] ?? [], usingFallback: true };
  }, [provider]);

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
  const noKey = provider?.keySource === null;

  const currentLabel = useMemo(() => {
    const name = providers.find((p) => p.id === extract.provider_id)?.name ?? "?";
    return `${name} / ${extract.model}`;
  }, [providers, extract]);

  const onProviderChange = (id: string) => {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    const stored = p
      ? p.models.filter((m) => isVisionCapableModel(p.api_format, m))
      : [];
    const list = stored.length > 0 ? stored : p ? (VISION_MODELS[p.api_format] ?? []) : [];
    setModelChoice(list[0] ?? CUSTOM);
    setSaved(false);
  };

  const apply = () => {
    if (!providerId || !model || noKey) return;
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
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          회사(프로바이더)
          <select
            value={providerId}
            onChange={(e) => onProviderChange(e.target.value)}
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
          OCR 모델
          <select
            value={modelChoice}
            onChange={(e) => {
              setModelChoice(e.target.value);
              setSaved(false);
            }}
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
              disabled={noKey}
            />
          </label>
        )}
        <button
          type="button"
          onClick={apply}
          disabled={pending || !model || noKey}
          className="rounded-md bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "저장 중…" : "적용"}
        </button>
        <span className="text-xs text-zinc-400">
          {saved ? "저장됨 · " : ""}현재: {currentLabel}
        </span>
      </div>
      {noKey && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          이 프로바이더는 등록된 API 키가 없습니다 — 페이즈 0에서 키를 먼저 등록하세요.
        </p>
      )}
      {!noKey && usingFallback && (
        <p className="text-xs text-zinc-400">
          저장된 모델 목록이 없어 기본 카탈로그를 표시합니다 — 계정의 [모델 갱신] 후 전체
          목록이 나옵니다.
        </p>
      )}
    </div>
  );
}
