"use client";

import type { ReactNode } from "react";

// 대시보드 페이즈 섹션 래퍼 (리팩토링 2 배치 5).
// 앵커 id(phase-0~3)로 [작업결과표 바로보기] 스크롤이 걸리고, 우측 버튼은 #worksheet로 이동한다.
// children은 서버 컴포넌트에서 렌더돼 전달된다(클라이언트 래퍼가 받는 표준 패턴).
export function PhaseSection({
  id,
  step,
  title,
  desc,
  children,
}: {
  id: string;
  step: number;
  title: string;
  desc?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto mb-12 w-full max-w-4xl scroll-mt-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-white dark:bg-zinc-200 dark:text-zinc-900">
            {step}
          </span>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {desc && <p className="mt-0.5 text-sm text-zinc-500">{desc}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            document
              .getElementById("worksheet")
              ?.scrollIntoView({ behavior: "smooth" })
          }
          className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          작업결과표 바로보기
        </button>
      </div>
      {children}
    </section>
  );
}
