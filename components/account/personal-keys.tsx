"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  setPersonalKey,
  refreshPersonalKeyModels,
  deletePersonalKey,
  type KeyActionState,
} from "@/app/account/actions";
import type { ApiFormat, KeyStatus, Provider } from "@/lib/supabase/types";

const FORMAT_LABEL: Record<ApiFormat, string> = {
  anthropic: "anthropic",
  openai: "openai 호환",
  google: "google",
};

export function PersonalKeys({
  providers,
  personalKeys,
}: {
  providers: Provider[];
  personalKeys: Record<string, KeyStatus>;
}) {
  if (providers.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        등록된 프로바이더가 없습니다. 관리자에게 문의하세요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {providers.map((p) => (
        <KeyRow key={p.id} provider={p} status={personalKeys[p.id]} />
      ))}
    </div>
  );
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "미조회";
  return new Date(iso).toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function KeyRow({ provider, status }: { provider: Provider; status?: KeyStatus }) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction] = useActionState<KeyActionState, FormData>(
    setPersonalKey,
    null,
  );
  const [refreshState, refreshAction] = useActionState<KeyActionState, FormData>(
    refreshPersonalKeyModels,
    null,
  );
  const result = saveState ?? refreshState;

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{provider.name}</span>
          <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
            {FORMAT_LABEL[provider.api_format]}
          </span>
        </div>
        <div className="text-xs text-zinc-500">
          내 키:{" "}
          {status ? (
            <span className="font-mono">••••{status.last4}</span>
          ) : (
            <span className="text-zinc-400">미등록 (기본 키 사용)</span>
          )}
        </div>
      </div>

      {status && (
        <p className="mt-1 text-xs text-zinc-400">
          모델 {status.models.length}개 · 마지막 조회 {formatSyncedAt(status.syncedAt)}
        </p>
      )}

      {editing ? (
        <form action={saveAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="providerId" value={provider.id} />
          <input
            name="apiKey"
            type="password"
            required
            autoComplete="off"
            placeholder="새 API 키"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <SubmitButton idle="저장" busy="확인 중…" primary />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            취소
          </button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {status ? "키 변경" : "키 등록"}
          </button>
          {status && (
            <>
              <form action={refreshAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <SubmitButton idle="모델 갱신" busy="조회 중…" />
              </form>
              <form
                action={deletePersonalKey}
                onSubmit={(e) => {
                  if (!confirm(`${provider.name}의 내 키를 삭제할까요?`)) {
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
            </>
          )}
        </div>
      )}

      {result && (
        <p
          className={`mt-2 text-xs ${
            result.ok
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

// 키 검증은 외부 API를 호출하므로 수 초가 걸린다. 중복 제출을 막고 진행 중임을 알린다.
function SubmitButton({
  idle,
  busy,
  primary = false,
}: {
  idle: string;
  busy: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  const className = primary
    ? "rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
    : "rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? busy : idle}
    </button>
  );
}
