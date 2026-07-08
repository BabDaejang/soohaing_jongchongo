import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toAnthropicContent,
  toOpenAIContent,
  toGoogleContent,
} from "@/lib/llm/content";
import { VISION_MODELS, hasVisionCatalog } from "@/lib/llm/vision-models";

test("toAnthropicContent: 문자열은 그대로, 배열은 image/text 블록으로", () => {
  assert.equal(toAnthropicContent("hi"), "hi");
  assert.deepEqual(
    toAnthropicContent([
      { type: "image", mediaType: "image/png", dataBase64: "AAA" },
      { type: "text", text: "extract" },
    ]),
    [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "text", text: "extract" },
    ],
  );
});

test("toAnthropicContent: PDF는 document 블록", () => {
  assert.deepEqual(
    toAnthropicContent([
      { type: "document", mediaType: "application/pdf", dataBase64: "PDF" },
    ]),
    [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "PDF" },
      },
    ],
  );
});

test("toOpenAIContent: 이미지는 data URI, PDF 문서는 명시적 에러", () => {
  assert.deepEqual(
    toOpenAIContent([{ type: "image", mediaType: "image/jpeg", dataBase64: "BBB" }]),
    [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB" } }],
  );
  assert.throws(
    () =>
      toOpenAIContent([
        { type: "document", mediaType: "application/pdf", dataBase64: "CCC" },
      ]),
    /PDF/,
  );
});

test("toGoogleContent: inlineData(mimeType/data)", () => {
  assert.deepEqual(
    toGoogleContent([
      { type: "document", mediaType: "application/pdf", dataBase64: "DDD" },
    ]),
    [{ inlineData: { mimeType: "application/pdf", data: "DDD" } }],
  );
  assert.deepEqual(toGoogleContent("hello"), [{ text: "hello" }]);
});

test("VISION_MODELS: 프로바이더 형식별 OCR 모델 카탈로그 (수용 — OCR 모델 선택)", () => {
  assert.ok(hasVisionCatalog("anthropic"));
  assert.ok(hasVisionCatalog("openai"));
  assert.ok(hasVisionCatalog("google"));
  assert.ok(VISION_MODELS.anthropic.includes("claude-haiku-4-5"));
});
