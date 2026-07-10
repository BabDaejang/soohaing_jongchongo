import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isOpenAIChatModel,
  parseAnthropicModels,
  parseOpenAIModels,
  parseGoogleModels,
  normalizeModelIds,
} from "@/lib/llm/models";

test("anthropic 응답에서 모델 id만 뽑는다", () => {
  const json = {
    data: [
      { type: "model", id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
      { type: "model", id: "claude-haiku-4-5" },
    ],
    has_more: false,
  };
  assert.deepEqual(parseAnthropicModels(json), [
    "claude-opus-4-8",
    "claude-haiku-4-5",
  ]);
});

test("openai 응답에서 채팅 불가 모델을 걸러낸다", () => {
  const json = {
    data: [
      { id: "gpt-4o" },
      { id: "gpt-4o-mini" },
      { id: "o3-mini" },
      { id: "text-embedding-3-large" }, // 임베딩
      { id: "whisper-1" }, // 음성 인식
      { id: "dall-e-3" }, // 이미지 생성
      { id: "gpt-4o-audio-preview" }, // 오디오 변형
      { id: "gpt-4o-realtime-preview" }, // 실시간 변형
      { id: "gpt-3.5-turbo-instruct" }, // legacy completions
      { id: "gpt-image-1" }, // 이미지 생성
      { id: "gpt-5.2-codex" }, // responses API 전용
      { id: "gpt-5-search-api" }, // responses API 전용
      { id: "sora-2" }, // 영상 생성
      { id: "omni-moderation-latest" }, // 모더레이션
    ],
  };
  assert.deepEqual(parseOpenAIModels(json), ["gpt-4o", "gpt-4o-mini", "o3-mini"]);
});

test("chat-latest 계열은 채팅 모델로 남는다", () => {
  assert.equal(isOpenAIChatModel("gpt-5.2-chat-latest"), true);
  assert.equal(isOpenAIChatModel("chatgpt-4o-latest"), true);
  // chatgpt-image-latest는 gpt-image 규칙에 걸려 제외된다
  assert.equal(isOpenAIChatModel("chatgpt-image-latest"), false);
});

test("isOpenAIChatModel은 프리픽스와 제외 규칙을 모두 본다", () => {
  assert.equal(isOpenAIChatModel("gpt-4o"), true);
  assert.equal(isOpenAIChatModel("chatgpt-4o-latest"), true);
  assert.equal(isOpenAIChatModel("o1"), true);
  assert.equal(isOpenAIChatModel("babbage-002"), false); // 프리픽스 불일치
  assert.equal(isOpenAIChatModel("gpt-4o-tts"), false); // 제외 규칙
});

test("google 응답에서 generateContent 지원 모델만, models/ 접두사를 떼고 뽑는다", () => {
  const json = {
    models: [
      {
        name: "models/gemini-2.0-flash",
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
      {
        name: "models/text-embedding-004",
        supportedGenerationMethods: ["embedContent"],
      },
      { name: "models/aqa", supportedGenerationMethods: ["generateAnswer"] },
    ],
  };
  assert.deepEqual(parseGoogleModels(json), ["gemini-2.0-flash"]);
});

test("파서는 예상 밖 응답에도 던지지 않고 빈 배열을 준다", () => {
  for (const bad of [null, undefined, 42, "oops", [], { data: "nope" }, {}]) {
    assert.deepEqual(parseAnthropicModels(bad), []);
    assert.deepEqual(parseOpenAIModels(bad), []);
    assert.deepEqual(parseGoogleModels(bad), []);
  }
});

test("google 파서는 supportedGenerationMethods가 없거나 name이 없으면 건너뛴다", () => {
  const json = {
    models: [
      { name: "models/a" }, // methods 없음
      { supportedGenerationMethods: ["generateContent"] }, // name 없음
      { name: "b", supportedGenerationMethods: ["generateContent"] }, // 접두사 없음
    ],
  };
  assert.deepEqual(parseGoogleModels(json), ["b"]);
});

test("normalizeModelIds는 중복을 제거하고 정렬한다", () => {
  assert.deepEqual(normalizeModelIds(["gpt-4o", "gpt-4o-mini", "gpt-4o"]), [
    "gpt-4o",
    "gpt-4o-mini",
  ]);
  assert.deepEqual(normalizeModelIds([]), []);
});
