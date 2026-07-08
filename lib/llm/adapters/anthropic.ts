import "server-only";
import type { Adapter } from "../types";

// Anthropic Messages API (POST {baseUrl}/v1/messages).
// system 역할 메시지는 최상위 system 필드로, 나머지는 messages 배열로 보낸다.
export const anthropicAdapter: Adapter = async ({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens,
  temperature,
}) => {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const chat = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: chat,
  };
  if (system) body.system = system;
  if (temperature !== undefined) body.temperature = temperature;

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API 오류 (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

  return { text, model, raw: data };
};
