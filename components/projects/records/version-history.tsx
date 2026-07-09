"use client";

import { useState, useTransition } from "react";
import {
  listRecordVersions,
  type RecordVersion,
} from "@/app/projects/[id]/records/actions";
import type { RecordOrigin } from "@/lib/supabase/types";

const ORIGIN_LABEL: Record<RecordOrigin, string> = {
  generated: "생성",
  edited: "교사 편집",
  manual: "수동 작성",
};

// 버전 이력 열람 (SPEC 7.5 / 팩 8a). 펼칠 때 지연 로드한다.
export function VersionHistory({
  projectId,
  studentId,
  currentVersion,
}: {
  projectId: string;
  studentId: string;
  currentVersion: number;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<RecordVersion[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && versions === null) {
      startTransition(async () => {
        const v = await listRecordVersions(projectId, studentId);
        setVersions(v);
      });
    }
  }

  return (
    <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={toggle}
        className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        {open ? "버전 이력 접기" : "버전 이력 보기"} (현재 v{currentVersion})
      </button>
      {open && (
        <div className="mt-2">
          {pending && <p className="text-xs text-zinc-400">불러오는 중…</p>}
          {versions && versions.length === 0 && (
            <p className="text-xs text-zinc-400">이력이 없습니다.</p>
          )}
          <ul className="flex flex-col gap-1">
            {(versions ?? []).map((v) => (
              <li
                key={v.version}
                className="rounded border border-zinc-200 dark:border-zinc-800"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpanded(expanded === v.version ? null : v.version)
                  }
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span>
                    v{v.version} · {ORIGIN_LABEL[v.origin]}
                    {v.is_current && (
                      <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                        (현재)
                      </span>
                    )}
                  </span>
                  <span className="text-zinc-400">
                    {new Date(v.created_at).toLocaleString("ko-KR")}
                  </span>
                </button>
                {expanded === v.version && (
                  <p className="whitespace-pre-wrap border-t border-zinc-200 px-2 py-2 text-xs leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                    {v.content}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
