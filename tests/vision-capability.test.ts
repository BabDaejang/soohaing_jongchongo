import { test } from "node:test";
import assert from "node:assert/strict";
import { isVisionCapableModel } from "@/lib/llm/vision-capability";

test("isVisionCapableModel: 비전 가능 모델은 true", () => {
  assert.equal(isVisionCapableModel("anthropic", "claude-sonnet-4-6"), true);
  assert.equal(isVisionCapableModel("google", "gemini-2.0-flash"), true);
  assert.equal(isVisionCapableModel("openai", "gpt-4o"), true);
  assert.equal(isVisionCapableModel("openai", "gpt-4o-mini"), true);
  assert.equal(isVisionCapableModel("openai", "gpt-4.1"), true);
  assert.equal(isVisionCapableModel("openai", "gpt-4-turbo"), true);
  assert.equal(isVisionCapableModel("openai", "gpt-5.4"), true);
  assert.equal(isVisionCapableModel("openai", "chatgpt-4o-latest"), true);
  assert.equal(isVisionCapableModel("openai", "o3"), true);
  assert.equal(isVisionCapableModel("openai", "o4-mini"), true);
});

test("isVisionCapableModel: 비전 불가·비대상 모델은 false", () => {
  assert.equal(isVisionCapableModel("openai", "gpt-3.5-turbo"), false);
  assert.equal(isVisionCapableModel("openai", "o1-mini"), false);
  assert.equal(isVisionCapableModel("openai", "o3-mini"), false);
  assert.equal(isVisionCapableModel("openai", "gpt-4"), false); // 무접미
  assert.equal(isVisionCapableModel("openai", "text-embedding-3-small"), false);
  assert.equal(isVisionCapableModel("google", "aqa"), false);
});

test("isVisionCapableModel: 판정 기준은 format — 교차 케이스", () => {
  // anthropic 형식에 openai 모델명이 와도 claude- 접두 아니면 false.
  assert.equal(isVisionCapableModel("anthropic", "gpt-4o"), false);
  // openai 형식에 claude 모델명이 와도 openai 휴리스틱을 통과하지 않으면 false.
  assert.equal(isVisionCapableModel("openai", "claude-sonnet-4-6"), false);
});
