"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  extractPlanText,
  analyzeRubricPlan,
  saveRubric,
} from "@/app/projects/[id]/rubric/actions";
import type { RubricCriterion } from "@/lib/supabase/types";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "오류가 발생했습니다.";
}

// 평가계획서 업로드 → AI 분석 → diff 승인 반영 (리팩토링 2 배치 7).
// 자동 저장 금지(보수 원칙): [선택 항목 반영] 클릭 시에만 기존 saveRubric 경로로 저장한다.
// 반영 = 현재 루브릭을 체크된 제안 항목으로 **교체**한다.
export function RubricPlanPanel({
  projectId,
  currentCriteria,
}: {
  projectId: string;
  currentCriteria: RubricCriterion[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [planText, setPlanText] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<RubricCriterion[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [uploadBusy, setUploadBusy] = useState(false);
  const [analyzePending, startAnalyze] = useTransition();
  const [applyPending, startApply] = useTransition();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploadBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const { text, filename: fn } = await extractPlanText(projectId, fd);
      setPlanText(text);
      setFilename(fn);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploadBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onAnalyze() {
    setError(null);
    setNotice(null);
    setSuggestions(null);
    startAnalyze(async () => {
      try {
        const result = await analyzeRubricPlan(projectId, planText);
        setSuggestions(result);
        setSelected(new Set(result.map((c) => c.id))); // 기본 전체 채택
      } catch (e) {
        setError(errMsg(e));
      }
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onApply() {
    if (!suggestions) return;
    const chosen = suggestions.filter((c) => selected.has(c.id));
    if (chosen.length === 0) {
      setError("반영할 기준을 최소 1개 선택하세요.");
      return;
    }
    setError(null);
    startApply(async () => {
      try {
        // 기존 saveRubric 경로로 저장(교체) — 서버가 재검증한다.
        const fd = new FormData();
        fd.set("projectId", projectId);
        fd.set("criteria", JSON.stringify(chosen));
        await saveRubric(fd);
        setNotice(`루브릭을 ${chosen.length}개 기준으로 교체했습니다.`);
        setSuggestions(null);
        setPlanText("");
        setFilename(null);
        router.refresh();
      } catch (e) {
        setError(errMsg(e));
      }
    });
  }

  const inputClass =
    "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-left"
      >
        <div>
          <h3 className="text-sm font-semibold">평가계획서로 루브릭 만들기 (AI)</h3>
          <p className="mt-1 text-xs text-zinc-500">
            평가계획서를 올리거나 붙여넣어 AI가 채점 기준을 제안합니다. 선택한 항목만
            반영됩니다(자동 저장 없음).
          </p>
        </div>
        <span className="text-xs text-zinc-400">{open ? "접기 ▲" : "펼치기 ▼"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadBusy}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {uploadBusy ? "추출 중…" : "파일 선택"}
            </button>
            <span className="text-xs text-zinc-400">
              txt · md · docx · pdf(텍스트) · xlsx · csv
              {filename && ` · ${filename}`}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.docx,.pdf,.xlsx,.csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="hidden"
            />
          </div>

          <textarea
            value={planText}
            onChange={(e) => setPlanText(e.target.value)}
            rows={5}
            placeholder="여기에 평가계획서 텍스트를 붙여넣거나 파일을 선택하세요."
            className={`${inputClass} resize-y`}
          />

          <div>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={analyzePending || !planText.trim()}
              className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              {analyzePending ? "분석 중…" : "AI 분석"}
            </button>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {notice && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>
          )}

          {suggestions && (
            <div className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50/50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
              <p className="text-xs text-sky-900 dark:text-sky-200">
                아래 제안으로 <b>현재 루브릭을 교체</b>합니다. 반영할 항목을 선택하세요.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {/* 현재 루브릭 */}
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold text-zinc-500">
                    현재 루브릭 ({currentCriteria.length})
                  </h4>
                  <ul className="flex flex-col gap-1.5">
                    {currentCriteria.length === 0 && (
                      <li className="text-xs text-zinc-400">(비어 있음)</li>
                    )}
                    {currentCriteria.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs dark:border-zinc-800"
                      >
                        <span className="font-medium">{c.name}</span>{" "}
                        <span className="text-zinc-400">
                          · {c.max_score}점 · 가중치 {c.weight}
                        </span>
                        {c.description && (
                          <p className="mt-0.5 text-zinc-500">{c.description}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* AI 제안 */}
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                    AI 제안 ({suggestions.length})
                  </h4>
                  <ul className="flex flex-col gap-1.5">
                    {suggestions.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-start gap-2 rounded-md border border-sky-200 bg-white px-2.5 py-1.5 text-xs dark:border-sky-900 dark:bg-zinc-900"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggle(c.id)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <div>
                          <span className="font-medium">{c.name}</span>{" "}
                          <span className="text-zinc-400">
                            · {c.max_score}점 · 가중치 {c.weight}
                          </span>
                          {c.description && (
                            <p className="mt-0.5 text-zinc-500">{c.description}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onApply}
                  disabled={applyPending || selected.size === 0}
                  className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-60"
                >
                  {applyPending ? "반영 중…" : `선택 항목 반영 (${selected.size})`}
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestions(null)}
                  disabled={applyPending}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
