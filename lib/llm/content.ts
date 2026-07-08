// 메시지 콘텐츠를 프로바이더별 형식으로 매핑하는 순수 함수 (세션 5, 비전 OCR).
// 시크릿을 다루지 않으므로 server-only가 아니며 단위 테스트 대상이다. 어댑터가 이걸 사용한다.
import type { LLMContentPart, LLMMessage } from "./types";

// system 메시지 등 텍스트가 필요한 곳에서 콘텐츠를 평문으로 환원.
export function contentToText(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<LLMContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
}

// ── Anthropic Messages API 블록 ──────────────────────────────────────
type AnthropicBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

export function toAnthropicContent(
  content: LLMMessage["content"],
): string | AnthropicBlock[] {
  if (typeof content === "string") return content;
  return content.map((p): AnthropicBlock => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (p.type === "image") {
      return {
        type: "image",
        source: { type: "base64", media_type: p.mediaType, data: p.dataBase64 },
      };
    }
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: p.dataBase64 },
    };
  });
}

// ── OpenAI 호환 Chat Completions 콘텐츠 ──────────────────────────────
// PDF 문서 파트는 표준 chat completions가 지원하지 않으므로 명시적 에러.
type OpenAIPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export function toOpenAIContent(
  content: LLMMessage["content"],
): string | OpenAIPart[] {
  if (typeof content === "string") return content;
  return content.map((p): OpenAIPart => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (p.type === "image") {
      return {
        type: "image_url",
        image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` },
      };
    }
    throw new Error(
      "openai 형식은 PDF 문서 입력을 지원하지 않습니다. 스캔 PDF OCR은 anthropic 또는 google 프로바이더를 사용하세요.",
    );
  });
}

// ── Google Gemini parts ──────────────────────────────────────────────
type GooglePart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export function toGoogleContent(content: LLMMessage["content"]): GooglePart[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((p): GooglePart => {
    if (p.type === "text") return { text: p.text };
    if (p.type === "image") {
      return { inlineData: { mimeType: p.mediaType, data: p.dataBase64 } };
    }
    return { inlineData: { mimeType: "application/pdf", data: p.dataBase64 } };
  });
}
