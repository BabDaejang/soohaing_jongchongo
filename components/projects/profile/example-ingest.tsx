"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  analyzeExample,
  applyProfileSuggestions,
  extractExampleText,
} from "@/app/projects/[id]/records/actions";
import type { ProfileSuggestion } from "@/lib/records/suggestions";

type Layer = "account" | "project";
type Row = { suggestion: ProfileSuggestion; approved: boolean };

// 예시 생기부 인제스트 (SPEC 7.5). 텍스트 → LLM 분석 → diff 제안 → 교사 승인 항목만 반영.
// 자동 반영 금지: analyzeExample은 쓰지 않고, applyProfileSuggestions가 승인분만 저장한다.
export function ExampleIngest({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [layer, setLayer] = useState<Layer>("account");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 파일 → 서버 추출(txt/md/docx/pdf/xlsx/csv) → 입력창에 채움. 교사가 확인 후 분석.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setError(null);
    setMsg(null);
    setRows(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const r = await extractExampleText(projectId, fd);
        setText(r.text);
        setMsg(`'${r.filename}'에서 ${r.text.length.toLocaleString()}자 추출 — 내용 확인 후 분석하세요.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "파일 추출 실패");
      }
    });
  }

  function analyze() {
    setError(null);
    setMsg(null);
    setRows(null);
    startTransition(async () => {
      try {
        const suggestions = await analyzeExample(projectId, layer, text);
        setRows(suggestions.map((s) => ({ suggestion: s, approved: false })));
        if (suggestions.length === 0) setMsg("제안할 항목이 없습니다.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "분석 실패");
      }
    });
  }

  function apply() {
    const approved = (rows ?? [])
      .filter((r) => r.approved)
      .map((r) => r.suggestion);
    if (approved.length === 0) {
      setError("반영할 항목을 선택하세요.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await applyProfileSuggestions(projectId, layer, approved);
        setMsg(`${approved.length}개 항목을 반영했습니다.`);
        setRows(null);
        setText("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "반영 실패");
      }
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">예시 생기부로 프로필 다듬기</h2>
      <p className="mt-1 text-xs text-zinc-500">
        좋은 예시를 파일(txt·md·docx·pdf·xlsx·csv)로 올리거나 텍스트를 붙여넣으면
        참고/금지 항목 제안을 만듭니다. 승인한 항목만 프로필에 반영됩니다(자동 반영
        없음). 한글(hwp) 파일은 PDF/docx로 저장 후 업로드하세요.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-zinc-500">반영 대상</span>
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {(["account", "project"] as Layer[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLayer(l)}
              className={`px-2.5 py-1 text-xs ${
                layer === l
                  ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {l === "account" ? "계정 기본" : "프로젝트 오버라이드"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="file"
          accept=".txt,.md,.docx,.pdf,.xlsx,.csv"
          onChange={onFile}
          disabled={pending}
          className="text-xs"
        />
        {pending && <span className="text-xs text-zinc-400">추출 중…</span>}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="좋은 생기부 예시 텍스트를 붙여넣거나 위에서 파일을 선택하세요."
        className="mt-2 w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={analyze}
          disabled={pending || !text.trim()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {pending ? "처리 중…" : "분석"}
        </button>
        {msg && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">
            {msg}
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {rows && rows.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-zinc-500">
            제안 {rows.length}개 — 반영할 항목을 선택하세요
          </p>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r, idx) => {
              const s = r.suggestion;
              return (
                <li
                  key={idx}
                  className="flex items-start gap-2 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={r.approved}
                    onChange={(e) =>
                      setRows((prev) =>
                        (prev ?? []).map((x, i) =>
                          i === idx ? { ...x, approved: e.target.checked } : x,
                        ),
                      )
                    }
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-800">
                        {s.kind === "guideline" ? "참고" : "금지"}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          s.action === "add"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                        }`}
                      >
                        {s.action === "add" ? "추가" : "수정"}
                      </span>
                    </div>
                    {s.before && (
                      <p className="mt-1 text-xs text-zinc-400 line-through">
                        {s.before}
                      </p>
                    )}
                    <p className="mt-0.5 text-zinc-800 dark:text-zinc-100">
                      {s.text}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={apply}
            disabled={pending}
            className="mt-3 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            승인 항목 반영
          </button>
        </div>
      )}
    </div>
  );
}
