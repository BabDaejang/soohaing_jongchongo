"use client";

import { useState } from "react";
import type { ColumnMapping } from "@/lib/parsing/types";

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const ROLES: Array<{ key: keyof ColumnMapping; label: string }> = [
  { key: "studentNo", label: "학번" },
  { key: "studentName", label: "이름" },
  { key: "submissionId", label: "제출물 ID" },
  { key: "content", label: "제출 내용" },
];

// 스프레드시트 열 매핑 UI (SPEC 5.1). LLM 초기 추천값을 교사가 확정한다.
export function ColumnMapper({
  filename,
  headers,
  sampleRows,
  initial,
  busy,
  onConfirm,
  onCancel,
}: {
  filename: string;
  headers: string[];
  sampleRows: string[][];
  initial: ColumnMapping;
  busy: boolean;
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}) {
  const [mapping, setMapping] = useState<ColumnMapping>(initial);

  const setRole = (key: keyof ColumnMapping, value: string) =>
    setMapping((prev) => ({
      ...prev,
      [key]: value === "" ? null : Number(value),
    }));

  return (
    <div className="rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <div className="mb-3 text-sm">
        <span className="font-medium">{filename}</span>
        <span className="ml-2 text-xs text-zinc-500">
          열을 확인하고 확정하세요. LLM이 초기 추천했습니다.
        </span>
      </div>

      <div className="mb-4 overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-2 py-1 font-medium">
                  {i}: {h || "(빈 헤더)"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, ri) => (
              <tr key={ri} className="border-t border-zinc-100 dark:border-zinc-800">
                {headers.map((_, ci) => (
                  <td key={ci} className="whitespace-nowrap px-2 py-1 text-zinc-600 dark:text-zinc-300">
                    {(row[ci] ?? "").slice(0, 40)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ROLES.map((r) => (
          <label key={r.key} className="flex flex-col gap-1 text-xs text-zinc-500">
            {r.label}
            <select
              value={mapping[r.key] ?? ""}
              onChange={(e) => setRole(r.key, e.target.value)}
              className={inputClass}
            >
              <option value="">(없음)</option>
              {headers.map((h, i) => (
                <option key={i} value={i}>
                  {i}: {h || "(빈 헤더)"}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {mapping.content == null && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
          &ldquo;제출 내용&rdquo; 열을 지정해야 제출물을 만들 수 있습니다.
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 disabled:opacity-60 dark:hover:text-zinc-200"
        >
          건너뛰기
        </button>
        <button
          type="button"
          onClick={() => onConfirm(mapping)}
          disabled={busy || mapping.content == null}
          className="rounded-md bg-zinc-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {busy ? "처리 중…" : "이 매핑으로 수합"}
        </button>
      </div>
    </div>
  );
}
