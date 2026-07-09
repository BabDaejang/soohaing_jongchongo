// 생기부 글자수 카운터 (SPEC 7.6). **순수 함수** — 클라이언트/서버 공용(server-only 아님).
//   chars: 글자수(공백 포함). 코드 포인트 기준(서로게이트 쌍을 1자로).
//   bytes: UTF-8 바이트 길이(한글은 3바이트). TextEncoder는 브라우저·Node 공통.
import type { CountMethod } from "@/lib/supabase/types";

const encoder = new TextEncoder();

export function countText(text: string, method: CountMethod): number {
  if (method === "bytes") return encoder.encode(text).length;
  return [...text].length; // chars — 공백 포함, 코드 포인트 기준
}

export const COUNT_METHOD_LABEL: Record<CountMethod, string> = {
  chars: "글자수(공백 포함)",
  bytes: "바이트(한글 3)",
};
