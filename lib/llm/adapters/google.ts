import "server-only";
import type { Adapter } from "../types";

// Google Gemini generateContent API
// (POST {baseUrl}/v1beta/models/{model}:generateContent?key=...).
// system 메시지는 systemInstruction으로, assistant는 role 'model'로 매핑한다.
export const googleAdapter: Adapter = async ({
  baseUrl,
  apiKey,
  model,
  messages,
  maxTokens,
  temperature,
}) => {
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (temperature !== undefined) generationConfig.temperature = temperature;

  const body: Record<string, unknown> = { contents, generationConfig };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

  // API 키는 쿼리 파라미터로 전달된다 — URL을 로그에 남기지 않는다.
  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Google API 오류 (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("");

  return { text, model, raw: data };
};
