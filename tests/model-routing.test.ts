import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MODELS,
  buildDefaultModelRouting,
  routingKeyForPurpose,
} from "@/lib/llm/routing";
import type { ModelRouting } from "@/lib/llm/types";

// 수용 기준 4: model_routing 기본값이 DEFAULT_MODELS + 시드 프로바이더 id로 정확히 조립된다.
test("buildDefaultModelRouting가 DEFAULT_MODELS·provider_id로 조립한다", () => {
  const providerId = "anthropic-provider-uuid";
  const routing = buildDefaultModelRouting(providerId);

  // 네 개 라우팅 키가 모두 존재
  assert.deepEqual(Object.keys(routing).sort(), [
    "evaluate",
    "extract",
    "generate",
    "verify",
  ]);

  // 각 키의 모델은 DEFAULT_MODELS와 일치, provider_id는 넘긴 값과 동일
  for (const key of ["extract", "evaluate", "generate", "verify"] as const) {
    assert.equal(routing[key].model, DEFAULT_MODELS[key]);
    assert.equal(routing[key].provider_id, providerId);
  }
});

test("SPEC 3절 기본 모델: 추출=haiku, 평가/생성/검증=sonnet", () => {
  const routing = buildDefaultModelRouting("p");
  assert.equal(routing.extract.model, "claude-haiku-4-5");
  assert.equal(routing.evaluate.model, "claude-sonnet-4-6");
  assert.equal(routing.generate.model, "claude-sonnet-4-6");
  assert.equal(routing.verify.model, "claude-sonnet-4-6");
});

// 수용 6: model_routing 편집으로 바꾼 provider_id·model로 callLLM이 라우팅된다.
// callLLM은 routingKeyForPurpose(purpose)로 대상을 고르므로, 그 선택 로직을 검증한다.
test("purpose '평가'는 evaluate 대상(편집된 provider_id·model)을 사용한다", () => {
  const routing: ModelRouting = {
    extract: { provider_id: "anthropic-id", model: "claude-haiku-4-5" },
    // 교사가 openai 프로바이더·모델로 평가 라우팅을 변경한 상황
    evaluate: { provider_id: "openai-id", model: "gpt-4o" },
    generate: { provider_id: "anthropic-id", model: "claude-sonnet-4-6" },
    verify: { provider_id: "anthropic-id", model: "claude-sonnet-4-6" },
  };
  const key = routingKeyForPurpose("평가");
  assert.equal(key, "evaluate");
  assert.equal(routing[key].provider_id, "openai-id");
  assert.equal(routing[key].model, "gpt-4o");
});
