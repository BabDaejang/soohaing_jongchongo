"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { updateModelRouting } from "@/app/projects/[id]/evaluate/actions";
import { VISION_MODELS } from "@/lib/llm/vision-models";
import type { ModelRouting, RoutingKey } from "@/lib/llm/types";
import type { ApiFormat } from "@/lib/supabase/types";

type ProviderOpt = { id: string; name: string; api_format: ApiFormat };

const KEYS: { key: RoutingKey; label: string; help: string }[] = [
  { key: "extract", label: "추출 · 매칭", help: "파일 텍스트 추출 · OCR · 매칭 보조 (저비용 권장)" },
  { key: "evaluate", label: "평가 (채점)", help: "루브릭 기준 채점" },
  { key: "generate", label: "생성", help: "생기부 초안 생성" },
  { key: "verify", label: "검증", help: "생기부 근거 검증" },
];

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function ModelRoutingForm({
  projectId,
  routing,
  providers,
}: {
  projectId: string;
  routing: ModelRouting;
  providers: ProviderOpt[];
}) {
  const [sel, setSel] = useState<
    Record<RoutingKey, { provider: string; model: string }>
  >(() => {
    const init = {} as Record<RoutingKey, { provider: string; model: string }>;
    for (const { key } of KEYS) {
      init[key] = {
        provider: routing[key]?.provider_id ?? providers[0]?.id ?? "",
        model: routing[key]?.model ?? "",
      };
    }
    return init;
  });

  function setProvider(key: RoutingKey, provider: string) {
    setSel((s) => ({ ...s, [key]: { ...s[key], provider } }));
  }
  function setModel(key: RoutingKey, model: string) {
    setSel((s) => ({ ...s, [key]: { ...s[key], model } }));
  }

  function catalogFor(providerId: string): string[] {
    const fmt = providers.find((p) => p.id === providerId)?.api_format;
    return fmt ? (VISION_MODELS[fmt] ?? []) : [];
  }

  return (
    <form
      action={updateModelRouting}
      className="flex flex-col gap-5 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <div>
        <h3 className="text-sm font-semibold">모델 라우팅</h3>
        <p className="mt-1 text-xs text-zinc-500">
          용도별로 프로바이더와 모델을 지정합니다. 개인 키를 등록한 프로바이더로 바꾸면
          해당 프로바이더의 개인 키가 사용됩니다. 모델은 목록에서 고르거나 직접 입력할 수
          있습니다.
        </p>
      </div>

      {KEYS.map(({ key, label, help }) => {
        const options = catalogFor(sel[key].provider);
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{label}</span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                name={`${key}_provider`}
                value={sel[key].provider}
                onChange={(e) => setProvider(key, e.target.value)}
                className={selectClass}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                name={`${key}_model`}
                value={sel[key].model}
                onChange={(e) => setModel(key, e.target.value)}
                list={`${key}-models`}
                placeholder="모델 ID"
                required
                className={`${selectClass} min-w-52 flex-1`}
              />
              {options.length > 0 && (
                <datalist id={`${key}-models`}>
                  {options.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>
            <span className="text-xs text-zinc-400">{help}</span>
          </div>
        );
      })}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
    >
      {pending ? "저장 중…" : "라우팅 저장"}
    </button>
  );
}
