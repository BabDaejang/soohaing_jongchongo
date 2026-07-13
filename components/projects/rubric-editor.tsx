"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveRubric } from "@/app/projects/[id]/rubric/actions";
import {
  formatDownloadStamp,
  sanitizeFilename,
} from "@/lib/worksheet/download";
import type { RubricCriterion } from "@/lib/supabase/types";

function newCriterion(): RubricCriterion {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    max_score: 10,
    weight: 1,
  };
}

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function RubricEditor({
  projectId,
  projectName,
  initialCriteria,
}: {
  projectId: string;
  projectName: string;
  initialCriteria: RubricCriterion[];
}) {
  const [criteria, setCriteria] = useState<RubricCriterion[]>(
    initialCriteria.length > 0 ? initialCriteria : [newCriterion()],
  );

  const update = (id: string, patch: Partial<RubricCriterion>) =>
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );

  const remove = (id: string) =>
    setCriteria((prev) => prev.filter((c) => c.id !== id));

  const add = () => setCriteria((prev) => [...prev, newCriterion()]);

  // 현재 편집 중인 기준을 4열 xlsx로 내보낸다(배치 3 download 패턴 재사용, SheetJS 동적 import).
  async function downloadXlsx() {
    const aoa: (string | number)[][] = [
      ["기준", "설명", "배점", "가중치"],
      ...criteria.map((c): (string | number)[] => [
        c.name,
        c.description,
        c.max_score,
        c.weight,
      ]),
    ];
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "루브릭");
    const stamp = formatDownloadStamp(new Date());
    XLSX.writeFile(wb, `${sanitizeFilename(projectName)}-루브릭-${stamp}.xlsx`);
  }

  return (
    <form action={saveRubric} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      {/* 클라이언트 상태를 그대로 직렬화해 서버로 넘긴다. 서버가 재검증한다. */}
      <input type="hidden" name="criteria" value={JSON.stringify(criteria)} />

      <ul className="flex flex-col gap-3">
        {criteria.map((c, idx) => (
          <li
            key={c.id}
            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">
                기준 {idx + 1}
              </span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={criteria.length <= 1}
                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                삭제
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                기준 이름
                <input
                  value={c.name}
                  onChange={(e) => update(c.id, { name: e.target.value })}
                  placeholder="예: 과제 이해도"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                설명
                <textarea
                  value={c.description}
                  onChange={(e) =>
                    update(c.id, { description: e.target.value })
                  }
                  rows={2}
                  placeholder="이 기준으로 무엇을 보는지"
                  className={`${inputClass} resize-y`}
                />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  배점(만점)
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={c.max_score}
                    onChange={(e) =>
                      update(c.id, { max_score: Number(e.target.value) })
                    }
                    className={`${inputClass} w-28`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-500">
                  가중치
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={c.weight}
                    onChange={(e) =>
                      update(c.id, { weight: Number(e.target.value) })
                    }
                    className={`${inputClass} w-28`}
                  />
                </label>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={add}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            + 기준 추가
          </button>
          <button
            type="button"
            onClick={() => void downloadXlsx()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            xlsx 다운로드
          </button>
        </div>
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
    >
      {pending ? "저장 중…" : "루브릭 저장"}
    </button>
  );
}
