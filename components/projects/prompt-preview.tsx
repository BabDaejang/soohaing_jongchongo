"use client";

import { useState, useTransition } from "react";
import { previewGenerationPrompt } from "@/app/projects/[id]/records/actions";

// 최종 프롬프트 미리보기 (리팩토링 4 배치 5, P-7).
// 병합된 브리프·참고·금지가 실제로 어떻게 주입되는지 read-only로 보여 준다 — 조회만(쓰기·LLM 없음).
// 프로필 화면(zinc)과 대시보드 페이즈 3(neo) 양쪽에서 쓰므로 트리거 버튼 스타일만 variant로 가른다.

const TRIGGER_CLASS: Record<"zinc" | "neo", string> = {
  zinc: "rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800",
  neo: "border-2 border-black bg-white px-3 py-1 text-xs font-bold text-black shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-60 cursor-pointer",
};

export function PromptPreviewButton({
  projectId,
  variant = "zinc",
}: {
  projectId: string;
  variant?: "zinc" | "neo";
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ system: string; user: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function show() {
    setError(null);
    startTransition(async () => {
      try {
        // 열 때마다 다시 조회한다 — 방금 저장한 브리프가 바로 보여야 미리보기의 의미가 있다.
        setData(await previewGenerationPrompt(projectId));
        setOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "미리보기 실패");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        disabled={pending}
        title="병합된 브리프·참고·금지사항이 실제 생성 프롬프트에 어떻게 들어가는지 확인합니다"
        className={TRIGGER_CLASS[variant]}
      >
        {pending ? "조회 중…" : "최종 프롬프트 미리보기"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}

      {open && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                최종 프롬프트 미리보기
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                닫기 ✕
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto p-4 text-xs">
              <p className="text-zinc-500 dark:text-zinc-400">
                학생 제출물·관찰 메모 자리는 플레이스홀더입니다 — 실제 생성 시 해당 학생의
                데이터가 서버에서 조립되어 들어갑니다 (읽기 전용).
              </p>
              <section>
                <h4 className="mb-1 font-semibold text-zinc-600 dark:text-zinc-300">system</h4>
                <pre className="whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  {data.system}
                </pre>
              </section>
              <section>
                <h4 className="mb-1 font-semibold text-zinc-600 dark:text-zinc-300">user</h4>
                <pre className="whitespace-pre-wrap rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  {data.user}
                </pre>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
