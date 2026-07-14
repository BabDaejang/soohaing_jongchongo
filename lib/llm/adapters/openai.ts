import "server-only";
import type { Adapter } from "../types";
import { toOpenAIContent } from "../content";
import { LLMHttpError } from "../errors";

// gpt-5·o 계열(추론 모델)은 legacy 파라미터를 거부한다 (2026-07-11 탐침 확정):
//   max_tokens → 400 "Use 'max_completion_tokens' instead"
//   temperature(기본값 외) → 400 "Only the default (1) value is supported"
// 커스텀 openai 호환 엔드포인트(구형)와 gpt-4o 계열은 legacy 파라미터를 유지한다.
export function isOpenAIReasoningFamily(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

export function buildOpenAIChatBody(input: {
  model: string;
  messages: unknown[]; // toOpenAIContent 매핑이 끝난 배열
  maxTokens: number;
  temperature?: number;
}): Record<string, unknown> {
  const { model, messages, maxTokens, temperature } = input;
  if (isOpenAIReasoningFamily(model)) {
    return { model, messages, max_completion_tokens: maxTokens }; // temperature 생략(탐침 D)
  }
  const body: Record<string, unknown> = { model, messages, max_tokens: maxTokens };
  if (temperature !== undefined) body.temperature = temperature;
  return body;
}

// OpenAI 호환 Chat Completions API (POST {baseUrl}/chat/completions).
// system·user·assistant 역할을 그대로 messages 배열로 보낸다.
// content가 배열이면 이미지(image_url data URI)로 매핑된다. PDF는 file 파트로 매핑(비전 모델).
export const openaiAdapter: Adapter = async ({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens,
  temperature,
}) => {
  const body = buildOpenAIChatBody({
    model,
    messages: messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) })),
    maxTokens,
    temperature,
  });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new LLMHttpError(res.status, `OpenAI 호환 API 오류 (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  // 추론 토큰이 한도를 소진하면 content가 비어 조용히 전 기준 0점으로 저장되던 문제 방어.
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (!text.trim()) {
    throw new Error(
      `OpenAI 호환 API가 빈 응답을 반환했습니다 (finish_reason: ${choice?.finish_reason ?? "unknown"}) — 토큰 한도 소진 의심`,
    );
  }

  return { text, model, raw: data };
};
