"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptPendingContent,
  attributeExisting,
  attributeNew,
  rejectPendingContent,
  suggestMatchCandidates,
  type LlmCandidate,
} from "@/app/projects/[id]/submissions/actions";

type StudentOpt = { id: string; student_number: string | null; name: string };
type Candidate = { student_id: string; name: string; student_number: string | null };

export type QueueItem = {
  id: string;
  source_filename: string | null;
  content_text: string;
  match_status: "pending_confirm" | "update_pending";
  match_candidates: unknown;
  pending_content: unknown;
  raw_student_no: string | null;
  raw_student_name: string | null;
};

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const primaryBtn =
  "rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white";
const ghostBtn =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

export function ConfirmQueue({
  projectId,
  students,
  items,
}: {
  projectId: string;
  students: StudentOpt[];
  items: QueueItem[];
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
        확인 대기 중인 항목이 없습니다.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <QueueRow key={item.id} projectId={projectId} students={students} item={item} />
      ))}
    </ul>
  );
}

function QueueRow({
  projectId,
  students,
  item,
}: {
  projectId: string;
  students: StudentOpt[];
  item: QueueItem;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [llm, setLlm] = useState<LlmCandidate[] | null>(null);
  const [selected, setSelected] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState(item.raw_student_name ?? "");
  const [newNo, setNewNo] = useState(item.raw_student_no ?? "");
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const act = (fn: () => Promise<void>) =>
    start(async () => {
      setError("");
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "처리 실패");
      }
    });

  const candidates = (Array.isArray(item.match_candidates)
    ? (item.match_candidates as Candidate[])
    : []
  ).filter((c) => c && c.student_id);

  const pendingContent = item.pending_content as { content_text: string } | null;

  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {item.match_status === "update_pending" ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            내용 변경 대기
          </span>
        ) : (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">확인 대기</span>
        )}
        {(item.raw_student_no || item.raw_student_name) && (
          <span>
            {[item.raw_student_no, item.raw_student_name].filter(Boolean).join(" · ")}
          </span>
        )}
        {item.source_filename && <span className="text-zinc-400">{item.source_filename}</span>}
      </div>

      {item.match_status === "update_pending" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-zinc-400">현재 내용</div>
              <p className="line-clamp-4 rounded bg-zinc-50 p-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                {item.content_text.slice(0, 300) || "(빈 내용)"}
              </p>
            </div>
            <div>
              <div className="mb-1 text-xs text-zinc-400">새 내용(재업로드)</div>
              <p className="line-clamp-4 rounded bg-amber-50 p-2 text-sm text-zinc-600 dark:bg-amber-950/40 dark:text-zinc-300">
                {pendingContent?.content_text.slice(0, 300) || "(빈 내용)"}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => acceptPendingContent(projectId, item.id))}
              className={primaryBtn}
            >
              새 내용 반영
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => rejectPendingContent(projectId, item.id))}
              className={ghostBtn}
            >
              거부(기존 유지)
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 line-clamp-3 rounded bg-zinc-50 p-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
            {item.content_text.slice(0, 300) || "(빈 내용)"}
          </p>

          {candidates.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-xs text-zinc-400">이름 일치 후보</div>
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <button
                    key={c.student_id}
                    type="button"
                    disabled={pending}
                    onClick={() => act(() => attributeExisting(projectId, item.id, c.student_id))}
                    className={ghostBtn}
                  >
                    {c.name}
                    {c.student_number ? ` (${c.student_number})` : ""} 로 확정
                  </button>
                ))}
              </div>
            </div>
          )}

          {llm && (
            <div className="mb-2">
              <div className="mb-1 text-xs text-zinc-400">LLM 후보 제안</div>
              {llm.length === 0 ? (
                <p className="text-xs text-zinc-400">제안된 후보가 없습니다.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {llm.map((c) => (
                    <div key={c.student_id ?? c.name} className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pending || !c.student_id}
                        onClick={() =>
                          c.student_id &&
                          act(() => attributeExisting(projectId, item.id, c.student_id!))
                        }
                        className={ghostBtn}
                      >
                        {c.name}
                        {c.student_number ? ` (${c.student_number})` : ""} 로 확정
                      </button>
                      <span className="text-xs text-zinc-400">{c.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className={inputClass}
            >
              <option value="">학생 선택…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.student_number ? `${s.student_number} · ` : ""}
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !selected}
              onClick={() => act(() => attributeExisting(projectId, item.id, selected))}
              className={ghostBtn}
            >
              선택 학생으로 확정
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError("");
                  try {
                    setLlm(await suggestMatchCandidates(projectId, item.id));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "제안 실패");
                  }
                })
              }
              className={ghostBtn}
            >
              LLM 후보 제안
            </button>
            <button type="button" onClick={() => setShowNew((v) => !v)} className={ghostBtn}>
              신규 학생 생성
            </button>
            <button type="button" onClick={() => setHidden(true)} className={ghostBtn}>
              보류
            </button>
          </div>

          {showNew && (
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                학번(선택)
                <input value={newNo} onChange={(e) => setNewNo(e.target.value)} className={`${inputClass} w-28`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                이름
                <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} />
              </label>
              <button
                type="button"
                disabled={pending || !newName.trim()}
                onClick={() =>
                  act(() => attributeNew(projectId, item.id, newName, newNo || null))
                }
                className={primaryBtn}
              >
                생성·확정
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}
