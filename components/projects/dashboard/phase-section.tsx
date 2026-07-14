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
    <section id={id} className="mx-auto mb-16 w-full max-w-4xl scroll-mt-6 border-4 border-black bg-white p-6 shadow-neo-md rotate-[0.2deg]">
      <div className="mb-6 flex items-start justify-between gap-3 border-b-4 border-black pb-4">
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center border-4 border-black bg-neo-accent text-lg font-black text-white shadow-neo-sm rotate-[-3deg]">
            {step}
          </span>
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight text-black">{title}</h2>
            {desc && <p className="mt-1 text-sm font-bold text-black/70">{desc}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            document
              .getElementById("worksheet")
              ?.scrollIntoView({ behavior: "smooth" })
          }
          className="shrink-0 border-2 border-black bg-neo-secondary px-3 py-1.5 text-xs font-bold text-black shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer"
        >
          작업결과표 바로보기
        </button>
      </div>
      <div className="rotate-[-0.2deg]">{children}</div>
    </section>
  );
}
