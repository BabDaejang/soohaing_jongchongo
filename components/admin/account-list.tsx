"use client";

import { useState } from "react";
import { approveUser, rejectUser, deleteUser } from "@/app/admin/actions";
import type { Profile, ProfileStatus } from "@/lib/supabase/types";

const STATUS_LABEL: Record<ProfileStatus, string> = {
  pending: "대기",
  approved: "승인됨",
  rejected: "거부됨",
};

const FILTERS: Array<{ key: "all" | ProfileStatus; label: string }> = [
  { key: "all", label: "전체" },
  { key: "pending", label: "대기" },
  { key: "approved", label: "승인됨" },
  { key: "rejected", label: "거부됨" },
];

export function AccountList({ profiles }: { profiles: Profile[] }) {
  const [filter, setFilter] = useState<"all" | ProfileStatus>("all");
  const shown =
    filter === "all" ? profiles : profiles.filter((p) => p.status === filter);

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-2 font-medium">이메일 / 이름</th>
              <th className="px-4 py-2 font-medium">역할</th>
              <th className="px-4 py-2 font-medium">상태</th>
              <th className="px-4 py-2 font-medium text-right">처리</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-400">
                  해당 상태의 계정이 없습니다.
                </td>
              </tr>
            )}
            {shown.map((p) => (
              <tr
                key={p.id}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-2">
                  <div className="font-medium">{p.email}</div>
                  {p.name && (
                    <div className="text-xs text-zinc-500">{p.name}</div>
                  )}
                </td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">
                  {p.role === "admin" ? "관리자" : "교사"}
                </td>
                <td className="px-4 py-2">
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    {p.role !== "admin" && (
                      <>
                        {p.status !== "approved" && (
                          <form action={approveUser}>
                            <input type="hidden" name="userId" value={p.id} />
                            <button
                              type="submit"
                              className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                            >
                              승인
                            </button>
                          </form>
                        )}
                        {p.status !== "rejected" && (
                          <form action={rejectUser}>
                            <input type="hidden" name="userId" value={p.id} />
                            <button
                              type="submit"
                              className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
                            >
                              거부
                            </button>
                          </form>
                        )}
                        <form
                          action={deleteUser}
                          onSubmit={(e) => {
                            if (
                              !confirm(
                                `${p.email} 계정을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`,
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="userId" value={p.id} />
                          <button
                            type="submit"
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            삭제
                          </button>
                        </form>
                      </>
                    )}
                    {p.role === "admin" && (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
