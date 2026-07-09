"use client";

import { useState, useTransition } from "react";
import {
  saveRecordEdit,
  regenerateSentence,
} from "@/app/projects/[id]/records/actions";
import type { VerificationSentence } from "@/lib/supabase/types";

// 검증 결과 뷰 (SPEC 7.3). 문장 단위 렌더 + unsupported 하이라이트 + 문장별 [삭제/직접수정/재생성].
// 편집(삭제·직접수정)은 검증 재실행 없이 새 'edited' 버전 저장(재검증 보류 — 사용자 확정).
// 재생성만 해당 문장을 검증 재실행한다.
export function VerificationView({
  projectId,
  studentId,
  content,
  verification,
  onChanged,
}: {
  projectId: string;
  studentId: string;
  content: string;
  verification: VerificationSentence[] | null;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const items = verification ?? [];
  const hasSentences = items.length > 0;

  function persist(next: VerificationSentence[]) {
    setError(null);
    const newContent = next.map((i) => i.sentence).join(" ").trim();
    startTransition(async () => {
      try {
        await saveRecordEdit(projectId, studentId, newContent, next);
        setEditIdx(null);
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장 실패");
      }
    });
  }

  function onDelete(idx: number) {
    persist(items.filter((_, i) => i !== idx));
  }

  function onSaveEdit(idx: number) {
    const text = draft.trim();
    if (!text) return;
    const next = items.map((it, i) =>
      i === idx
        ? {
            sentence: text,
            grounded: true,
            source_submission_ids: [],
            teacher_edited: true,
          }
        : it,
    );
    persist(next);
  }

  function onRegen(idx: number) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await regenerateSentence(projectId, studentId, items[idx].sentence);
        const next = items.map((it, i) =>
          i === idx
            ? {
                sentence: r.text,
                grounded: r.grounded,
                source_submission_ids: r.source_submission_ids,
                ...(r.grounded_by_memo ? { grounded_by_memo: true } : {}),
              }
            : it,
        );
        persist(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "재생성 실패");
      }
    });
  }

  // 검증 결과가 없으면(검증 실패 등) 본문만 표시하고 문장별 편집은 제공하지 않는다.
  if (!hasSentences) {
    return (
      <div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-100">
          {content}
        </p>
        <p className="mt-2 text-xs text-zinc-400">
          검증 결과가 없어 문장별 편집을 제공하지 않습니다. 재생성하면 검증이 다시
          수행됩니다.
        </p>
      </div>
    );
  }

  const unsupported = items.filter((i) => !i.grounded && !i.teacher_edited).length;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        {unsupported > 0 ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
            근거 없는 문장 {unsupported}개
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            모든 문장이 근거에 기반함
          </span>
        )}
        {pending && <span className="text-zinc-400">처리 중…</span>}
      </div>

      <ul className="flex flex-col gap-1.5">
        {items.map((it, idx) => {
          const flagged = !it.grounded && !it.teacher_edited;
          return (
            <li
              key={idx}
              className={`rounded-md border p-2 text-sm ${
                flagged
                  ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              {editIdx === idx ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={2}
                    className="w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onSaveEdit(idx)}
                      disabled={pending}
                      className="rounded bg-zinc-800 px-2 py-1 text-xs text-white disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditIdx(null)}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <span className="leading-relaxed text-zinc-800 dark:text-zinc-100">
                    {it.sentence}
                    {it.teacher_edited && (
                      <span className="ml-1 align-middle text-[10px] text-zinc-400">
                        · 교사 편집
                      </span>
                    )}
                    {it.grounded_by_memo && (
                      <span className="ml-1 align-middle text-[10px] text-zinc-400">
                        · 메모 근거
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditIdx(idx);
                        setDraft(it.sentence);
                      }}
                      disabled={pending}
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      onClick={() => onRegen(idx)}
                      disabled={pending}
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
                    >
                      재생성
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(idx)}
                      disabled={pending}
                      className="rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950"
                    >
                      삭제
                    </button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
