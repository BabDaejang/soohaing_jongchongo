"use client";

import { useState } from "react";
import type { ColumnMapping } from "@/lib/parsing/types";

const inputClass =
  "rounded-md border-2 border-black bg-white px-2 py-1.5 text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 font-bold";

const ROLES: Array<{ key: "studentNo" | "studentName" | "submissionId"; label: string }> = [
  { key: "studentNo", label: "학번" },
  { key: "studentName", label: "이름" },
  { key: "submissionId", label: "제출물 ID" },
];

// 스프레드시트 열 매핑 UI (SPEC 5.1). LLM 초기 추천값을 교사가 확정한다.
// 제출 내용 열은 + 버튼으로 다중 추가 가능하며, 헤더명을 편집 및 개별 삭제할 수 있습니다.
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
  const [mapping, setMapping] = useState<ColumnMapping>(() => {
    let contentVal: Array<{ index: number; label: string }> = [];
    if (Array.isArray(initial.content)) {
      contentVal = initial.content.map((item: any) => {
        if (typeof item === "object" && item !== null && "index" in item) {
          return { index: Number(item.index), label: String(item.label || "") };
        }
        const idx = Number(item);
        return { index: idx, label: headers[idx] || `열 ${idx}` };
      });
    } else if (typeof initial.content === "number") {
      const idx = initial.content;
      contentVal = [{ index: idx, label: headers[idx] || `열 ${idx}` }];
    }
    return {
      studentNo: initial.studentNo,
      studentName: initial.studentName,
      submissionId: initial.submissionId,
      content: contentVal,
    };
  });

  const [selectedColToAdd, setSelectedColToAdd] = useState<string>("");

  const setRole = (key: "studentNo" | "studentName" | "submissionId", value: string) =>
    setMapping((prev) => ({
      ...prev,
      [key]: value === "" ? null : Number(value),
    }));

  const addContentColumn = () => {
    if (selectedColToAdd === "") return;
    const colIdx = Number(selectedColToAdd);
    if (!mapping.content.some((item) => item.index === colIdx)) {
      setMapping((prev) => ({
        ...prev,
        content: [
          ...prev.content,
          { index: colIdx, label: headers[colIdx] || `열 ${colIdx}` },
        ].sort((a, b) => a.index - b.index),
      }));
    }
    setSelectedColToAdd("");
  };

  const removeContentColumn = (colIdx: number) => {
    setMapping((prev) => ({
      ...prev,
      content: prev.content.filter((item) => item.index !== colIdx),
    }));
  };

  const updateContentColumnLabel = (colIdx: number, newLabel: string) => {
    setMapping((prev) => ({
      ...prev,
      content: prev.content.map((item) =>
        item.index === colIdx ? { ...item, label: newLabel } : item
      ),
    }));
  };

  return (
    <div className="rounded-lg border-4 border-black p-5 bg-white dark:bg-zinc-900 shadow-neo-md my-4">
      <div className="mb-4 text-sm font-bold text-black dark:text-white">
        <span>📂 {filename}</span>
        <span className="ml-2 text-xs font-bold text-zinc-500 block sm:inline">
          열 매핑을 확인하고 확정하세요.
        </span>
      </div>

      <div className="mb-4 overflow-x-auto rounded border-2 border-black">
        <table className="w-full text-xs font-bold">
          <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-b-2 border-black">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 font-black border-r border-zinc-300 dark:border-zinc-700 last:border-0">
                  {i}: {h || "(빈 헤더)"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, ri) => (
              <tr key={ri} className="border-t border-zinc-300 dark:border-zinc-700">
                {headers.map((_, ci) => (
                  <td key={ci} className="whitespace-nowrap px-3 py-1.5 text-zinc-600 dark:text-zinc-300 border-r border-zinc-200 dark:border-zinc-800 last:border-0">
                    {(row[ci] ?? "").slice(0, 40)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 학번, 이름, 제출물 ID 설정 */}
      <div className="grid gap-3 sm:grid-cols-3 mb-4 border-b-2 border-black pb-4">
        {ROLES.map((r) => (
          <label key={r.key} className="flex flex-col gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-bold">
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

      {/* 제출 내용 다중 열 선택 및 커스텀 헤더명 설정 */}
      <div className="mb-4">
        <span className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 mb-2">
          제출 내용 지정 열 및 헤더명 편집 (다중 선택 가능)
        </span>

        {mapping.content.length === 0 ? (
          <p className="text-xs font-bold text-amber-600 dark:text-amber-500 mb-3 bg-amber-50 dark:bg-amber-950/20 p-2 border-2 border-amber-300 dark:border-amber-900 rounded">
            ⚠️ 지정된 제출 내용 열이 없습니다. 아래에서 열을 추가해 주세요.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5 mb-4">
            {mapping.content.map((colItem) => (
              <div
                key={colItem.index}
                className="flex items-center gap-2 border-2 border-black bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-xs font-bold shadow-neo-sm"
              >
                <span className="text-black dark:text-white shrink-0 font-black">열 {colItem.index}:</span>
                <input
                  type="text"
                  value={colItem.label}
                  onChange={(e) => updateContentColumnLabel(colItem.index, e.target.value)}
                  className="flex-1 bg-white dark:bg-zinc-950 border-2 border-black rounded px-2 py-1 text-xs text-zinc-800 dark:text-zinc-100 font-bold"
                  placeholder="표기할 헤더명 입력..."
                />
                <button
                  type="button"
                  onClick={() => removeContentColumn(colItem.index)}
                  className="border-2 border-black bg-[#FF6B6B] text-white px-3 py-1 text-xs font-black shadow-neo-sm hover:translate-x-[0.5px] hover:translate-y-[0.5px] hover:shadow-none active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all cursor-pointer shrink-0"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 새 제출 내용 열 추가 */}
        <div className="flex gap-2 items-center">
          <select
            value={selectedColToAdd}
            onChange={(e) => setSelectedColToAdd(e.target.value)}
            className={`${inputClass} flex-1`}
          >
            <option value="">추가할 제출 내용 열 선택...</option>
            {headers.map((h, i) => {
              const isAdded = mapping.content.some((item) => item.index === i);
              return (
                <option key={i} value={i} disabled={isAdded}>
                  {i}: {h || "(빈 헤더)"} {isAdded ? "(이미 추가됨)" : ""}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            onClick={addContentColumn}
            disabled={selectedColToAdd === ""}
            className="border-2 border-black bg-white hover:bg-zinc-50 text-black px-4 py-1.5 text-xs font-black shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            + 추가
          </button>
        </div>
      </div>

      {mapping.content.length === 0 && (
        <p className="mt-2 text-xs font-bold text-red-600 dark:text-red-500">
          &ldquo;제출 내용&rdquo; 열을 최소 1개 이상 지정해야 수합을 진행할 수 있습니다.
        </p>
      )}

      {/* 네오 브루탈리즘 버튼 적용 */}
      <div className="mt-6 flex justify-end gap-3 border-t-2 border-black pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="border-4 border-black bg-white text-black px-5 py-2 text-sm font-black shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        >
          건너뛰기
        </button>
        <button
          type="button"
          onClick={() => onConfirm(mapping)}
          disabled={busy || mapping.content.length === 0}
          className="border-4 border-black bg-neo-accent text-white px-5 py-2 text-sm font-black shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        >
          {busy ? "처리 중…" : "이 매핑으로 수합"}
        </button>
      </div>
    </div>
  );
}
