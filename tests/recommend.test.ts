import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recommendCostEffective,
  type ModelCandidate,
} from "@/lib/llm/recommend";

function c(model: string, providerId = "p", providerName = "Prov"): ModelCandidate {
  return { providerId, providerName, model };
}

test("recommendCostEffective: 우선순위가 높은 계열을 고른다", () => {
  // claude-haiku(우선순위 2)가 gpt-4o(우선순위 4)보다 앞선다.
  const r = recommendCostEffective([c("gpt-4o"), c("claude-haiku-4-5")]);
  assert.equal(r?.model, "claude-haiku-4-5");
});

test("recommendCostEffective: 우선순위 순회가 바깥 루프(입력 순서 무관)", () => {
  // gpt-4o-mini(우선순위 1)가 gpt-4o(우선순위 4)보다 앞서므로 입력 순서와 무관하게 mini.
  const r = recommendCostEffective([c("gpt-4o"), c("gpt-4o-mini")]);
  assert.equal(r?.model, "gpt-4o-mini");
});

test("recommendCostEffective: startsWith로 접미 붙은 모델도 매칭", () => {
  const r = recommendCostEffective([c("gemini-2.5-flash-preview-09")]);
  assert.equal(r?.model, "gemini-2.5-flash-preview-09");
});

test("recommendCostEffective: 매칭 없으면 null", () => {
  assert.equal(recommendCostEffective([c("text-embedding-3-small")]), null);
  assert.equal(recommendCostEffective([]), null);
});

test("recommendCostEffective: 결정성 — 같은 입력 같은 출력", () => {
  const input = [c("claude-sonnet-4-6"), c("gemini-2.0-flash"), c("gpt-4o-mini")];
  const a = recommendCostEffective(input);
  const b = recommendCostEffective(input);
  assert.deepEqual(a, b);
  assert.equal(a?.model, "gpt-4o-mini");
});
