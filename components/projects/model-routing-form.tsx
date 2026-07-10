"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { updateModelRouting } from "@/app/projects/[id]/evaluate/actions";
import { VISION_MODELS } from "@/lib/llm/vision-models";
import type { RoutableProvider } from "@/lib/llm/available";
import type { ModelRouting, RoutingKey } from "@/lib/llm/types";

const KEYS: { key: RoutingKey; label: string; help: string }[] = [
  { key: "extract", label: "추출 · 매칭", help: "파일 텍스트 추출 · OCR · 매칭 보조 (저비용 권장)" },
  { key: "evaluate", label: "평가 (채점)", help: "루브릭 기준 채점" },
  { key: "generate", label: "생성", help: "생기부 초안 생성" },
  { key: "verify", label: "검증", help: "생기부 근거 검증" },
];

const CUSTOM = "__custom__";

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

// 키에 저장된 모델 목록을 쓰되, 0010 이전에 등록된 키는 목록이 비어 있으므로 정적 카탈로그로 폴백한다.
function modelOptions(provider: RoutableProvider | undefined): string[] {
  if (!provider) return [];
  if (provider.models.length > 0) return provider.models;
  return VISION_MODELS[provider.api_format] ?? [];
}

export function ModelRoutingForm({
  projectId,
  routing,
  providers,
}: {
  projectId: string;
  routing: ModelRouting;
  providers: RoutableProvider[];
}) {
  // 쓸 수 있는 키가 있는 프로바이더만 선택 대상이다 (SPEC 3절).
  const usable = providers.filter((p) => p.keySource !== null);
  const noKeys = usable.length === 0;
  // 키가 하나도 없으면 전 프로바이더를 비활성으로 보여준다 — 무엇을 등록해야 하는지 알 수 있도록.
  const listed = noKeys ? providers : usable;

  const [sel, setSel] = useState<
    Record<RoutingKey, { provider: string; choice: string; custom: string }>
  >(() => {
    const init = {} as Record<
      RoutingKey,
      { provider: string; choice: string; custom: string }
    >;
    for (const { key } of KEYS) {
      const saved = routing[key];
      const providerId = usable.some((p) => p.id === saved?.provider_id)
        ? saved.provider_id
        : (usable[0]?.id ?? "");
      const options = modelOptions(usable.find((p) => p.id === providerId));
      const inCatalog = saved?.model ? options.includes(saved.model) : false;
      init[key] = {
        provider: providerId,
        choice: inCatalog ? saved.model : CUSTOM,
        custom: inCatalog ? "" : (saved?.model ?? ""),
      };
    }
    return init;
  });

  // 저장된 프로바이더의 키가 사라진 경우(기본 키 삭제 등) 선택이 바뀌었음을 알린다.
  const displaced = KEYS.some(
    ({ key }) =>
      routing[key]?.provider_id && routing[key].provider_id !== sel[key].provider,
  );

  function setProvider(key: RoutingKey, providerId: string) {
    // 프로바이더가 바뀌면 모델 후보가 통째로 달라진다 — 이전 모델을 남기지 않는다.
    const first = modelOptions(usable.find((p) => p.id === providerId))[0];
    setSel((s) => ({
      ...s,
      [key]: { provider: providerId, choice: first ?? CUSTOM, custom: "" },
    }));
  }

  function resolveModel(key: RoutingKey): string {
    const { choice, custom } = sel[key];
    return choice === CUSTOM ? custom.trim() : choice;
  }

  const incomplete = KEYS.some(({ key }) => !sel[key].provider || !resolveModel(key));

  return (
    <form
      action={updateModelRouting}
      className="flex flex-col gap-5 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <div>
        <h3 className="text-sm font-semibold">모델 라우팅</h3>
        <p className="mt-1 text-xs text-zinc-500">
          용도별로 프로바이더와 모델을 지정합니다. API 키가 등록된 회사만 선택할 수
          있고, 모델 목록은 키 등록·갱신 시 해당 회사에서 받아온 것입니다.
        </p>
      </div>

      {noKeys && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          사용할 수 있는 API 키가 없습니다. 먼저 API 키를 등록해야 합니다 —{" "}
          <Link href="/account" className="underline underline-offset-2">
            계정 옵션
          </Link>
          에서 개인 API 키를 등록하거나 관리자에게 기본 키 등록을 요청하세요.
        </p>
      )}

      {!noKeys && displaced && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          저장된 프로바이더의 키를 더 이상 쓸 수 없어 선택을 바꿨습니다. 확인 후
          저장하세요.
        </p>
      )}

      {KEYS.map(({ key, label, help }) => {
        const options = modelOptions(usable.find((p) => p.id === sel[key].provider));
        const staleCatalog =
          usable.find((p) => p.id === sel[key].provider)?.models.length === 0;

        return (
          <div key={key} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{label}</span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                name={`${key}_provider`}
                value={sel[key].provider}
                onChange={(e) => setProvider(key, e.target.value)}
                disabled={noKeys}
                className={selectClass}
              >
                {noKeys && <option value="">— 선택 불가 —</option>}
                {listed.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.keySource === null}>
                    {p.name}
                    {p.keySource === null ? " (키 미등록)" : ""}
                  </option>
                ))}
              </select>

              <select
                value={sel[key].choice}
                onChange={(e) =>
                  setSel((s) => ({ ...s, [key]: { ...s[key], choice: e.target.value } }))
                }
                disabled={noKeys}
                className={selectClass}
              >
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={CUSTOM}>직접 입력…</option>
              </select>

              {sel[key].choice === CUSTOM && (
                <input
                  value={sel[key].custom}
                  onChange={(e) =>
                    setSel((s) => ({ ...s, [key]: { ...s[key], custom: e.target.value } }))
                  }
                  disabled={noKeys}
                  placeholder="모델 ID"
                  className={`${selectClass} min-w-52 flex-1`}
                />
              )}

              <input type="hidden" name={`${key}_model`} value={resolveModel(key)} />
            </div>
            <span className="text-xs text-zinc-400">
              {help}
              {!noKeys && staleCatalog && " · 모델 목록이 비어 있습니다. 계정 옵션에서 [모델 갱신]을 눌러 주세요."}
            </span>
          </div>
        );
      })}

      <div className="flex justify-end">
        <SubmitButton disabled={noKeys || incomplete} />
      </div>
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
    >
      {pending ? "저장 중…" : "라우팅 저장"}
    </button>
  );
}
