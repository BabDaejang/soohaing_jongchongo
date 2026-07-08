"use client";

import { useState } from "react";
import {
  addProvider,
  setDefaultKey,
  deleteDefaultKey,
} from "@/app/admin/actions";
import type { ApiFormat, Provider } from "@/lib/supabase/types";

const FORMAT_LABEL: Record<ApiFormat, string> = {
  anthropic: "anthropic",
  openai: "openai 호환",
  google: "google",
};

export function ProviderManager({
  providers,
  defaultKeyLast4,
}: {
  providers: Provider[];
  defaultKeyLast4: Record<string, string>;
}) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {providers.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p}
          last4={defaultKeyLast4[p.id]}
        />
      ))}

      {showAdd ? (
        <form
          action={addProvider}
          className="rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              이름
              <input
                name="name"
                required
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="예: azure-openai"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              API 형식
              <select
                name="api_format"
                defaultValue="anthropic"
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="anthropic">anthropic</option>
                <option value="openai">openai 호환</option>
                <option value="google">google</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              base_url (선택)
              <input
                name="base_url"
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="비우면 형식 기본값"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              추가
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          + 프로바이더 추가
        </button>
      )}
    </div>
  );
}

function ProviderRow({
  provider,
  last4,
}: {
  provider: Provider;
  last4?: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{provider.name}</span>
          <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
            {FORMAT_LABEL[provider.api_format]}
          </span>
          {provider.is_seed && (
            <span className="ml-2 text-xs text-zinc-400">시드</span>
          )}
        </div>
        <div className="text-xs text-zinc-500">
          기본 키:{" "}
          {last4 ? (
            <span className="font-mono">••••{last4}</span>
          ) : (
            <span className="text-zinc-400">미등록</span>
          )}
        </div>
      </div>

      {editing ? (
        <form
          action={setDefaultKey}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="providerId" value={provider.id} />
          <input
            name="apiKey"
            type="password"
            required
            autoComplete="off"
            placeholder="새 API 키"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            취소
          </button>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {last4 ? "키 변경" : "키 등록"}
          </button>
          {last4 && (
            <form
              action={deleteDefaultKey}
              onSubmit={(e) => {
                if (!confirm(`${provider.name}의 기본 키를 삭제할까요?`)) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="providerId" value={provider.id} />
              <button
                type="submit"
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                키 삭제
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
