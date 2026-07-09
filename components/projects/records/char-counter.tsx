"use client";

import { useState } from "react";
import { countText, COUNT_METHOD_LABEL } from "@/lib/text-count";
import type { CountMethod } from "@/lib/supabase/types";

// 글자수 카운터 (SPEC 7.6). 제한 대비 실시간 표시 + 카운트 방식 토글(글자수/바이트).
export function CharCounter({
  text,
  charLimit,
  initialMethod,
}: {
  text: string;
  charLimit: number;
  initialMethod: CountMethod;
}) {
  const [method, setMethod] = useState<CountMethod>(initialMethod);
  const count = countText(text, method);
  const over = count > charLimit;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={over ? "font-semibold text-red-600" : "text-zinc-500"}>
        {count} / {charLimit} {method === "bytes" ? "B" : "자"}
        {over && " · 초과"}
      </span>
      <div className="inline-flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700">
        {(["chars", "bytes"] as CountMethod[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`px-2 py-0.5 ${
              method === m
                ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
            title={COUNT_METHOD_LABEL[m]}
          >
            {m === "chars" ? "글자수" : "바이트"}
          </button>
        ))}
      </div>
    </div>
  );
}
