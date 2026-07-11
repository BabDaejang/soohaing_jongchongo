import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isOpenAIReasoningFamily,
  buildOpenAIChatBody,
} from "@/lib/llm/adapters/openai";

test("isOpenAIReasoningFamily는 gpt-5·o 계열만 추론 모델로 본다", () => {
  // 추론 모델 (legacy 파라미터 거부)
  assert.equal(isOpenAIReasoningFamily("gpt-5"), true);
  assert.equal(isOpenAIReasoningFamily("gpt-5.5"), true);
  assert.equal(isOpenAIReasoningFamily("gpt-5.4-mini"), true);
  assert.equal(isOpenAIReasoningFamily("o1"), true);
  assert.equal(isOpenAIReasoningFamily("o3-mini"), true);
  // legacy 파라미터를 유지하는 모델
  assert.equal(isOpenAIReasoningFamily("gpt-4o"), false);
  assert.equal(isOpenAIReasoningFamily("gpt-4.1"), false);
  assert.equal(isOpenAIReasoningFamily("chatgpt-4o-latest"), false);
});

test("추론 모델은 max_completion_tokens만 쓰고 temperature를 생략한다 (탐침 D)", () => {
  const body = buildOpenAIChatBody({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 16,
    temperature: 0,
  });
  assert.equal(body.max_completion_tokens, 16);
  assert.ok(!("max_tokens" in body));
  assert.ok(!("temperature" in body));
});

test("gpt-4o 계열은 max_tokens·temperature를 유지한다", () => {
  const body = buildOpenAIChatBody({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 16,
    temperature: 0,
  });
  assert.equal(body.max_tokens, 16);
  assert.equal(body.temperature, 0);
  assert.ok(!("max_completion_tokens" in body));
});

test("temperature 미지정이면 키 자체가 없다", () => {
  const body = buildOpenAIChatBody({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 16,
  });
  assert.equal(body.max_tokens, 16);
  assert.ok(!("temperature" in body));
});
