import "server-only";
import type { Adapter } from "../types";
import { toOpenAIContent } from "../content";

// OpenAI 호환 Chat Completions API (POST {baseUrl}/chat/completions).
// system·user·assistant 역할을 그대로 messages 배열로 보낸다.
// content가 배열이면 이미지(image_url data URI)로 매핑된다. PDF 파트는 미지원(에러).
export const openaiAdapter: Adapter = async ({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens,
  temperature,
}) => {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) })),
    max_tokens: maxTokens,
  };
  if (temperature !== undefined) body.temperature = temperature;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`OpenAI 호환 API 오류 (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";

  return { text, model, raw: data };
};
