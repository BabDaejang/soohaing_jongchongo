import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApiFormat } from "@/lib/supabase/types";
import {
  DEFAULT_BASE_URLS,
  DEFAULT_MAX_TOKENS,
  type Adapter,
  type LLMMessage,
  type LLMResult,
  type ModelRouting,
  type ModelTarget,
  type Purpose,
} from "./types";
import { routingKeyForPurpose } from "./routing";
import { resolveApiKey } from "./keys";
import { anthropicAdapter } from "./adapters/anthropic";
import { openaiAdapter } from "./adapters/openai";
import { googleAdapter } from "./adapters/google";

// LLM 통합 클라이언트 — 전부 서버 전용(INV-4). 'server-only'로 클라이언트 번들 유입을 차단한다.
export { resolveApiKey } from "./keys";
export { DEFAULT_MODELS, routingKeyForPurpose } from "./routing";
export type {
  LLMMessage,
  LLMContentPart,
  ModelRouting,
  ModelTarget,
  Purpose,
  LLMResult,
} from "./types";

const ADAPTERS: Record<ApiFormat, Adapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
};

export type CallLLMParams = {
  userId: string;
  purpose: Purpose;
  messages: LLMMessage[];
  // purpose → {provider_id, model} 라우팅. 세션 4의 프로젝트 model_routing에서 조립해 전달한다.
  modelRouting: ModelRouting;
  // 있으면 modelRouting[key] 대신 이 target을 쓴다(키 해석·어댑터 경로는 동일). 루브릭 전담
  // 모델 폴백(rubric ?? default ?? evaluate) 등 라우팅 밖 선택에 사용한다(배치 7). 기존 호출부 무영향.
  overrideTarget?: ModelTarget;
  maxTokens?: number;
  temperature?: number;
};

// purpose에 따라 모델을 라우팅하고, 개인/기본 API 키를 해석해, 프로바이더 형식에 맞는 어댑터로 호출한다.
export async function callLLM({
  userId,
  purpose,
  messages,
  modelRouting,
  overrideTarget,
  maxTokens,
  temperature,
}: CallLLMParams): Promise<LLMResult> {
  const key = routingKeyForPurpose(purpose);
  const target = overrideTarget ?? modelRouting[key];
  if (!target) {
    throw new Error(`모델 라우팅에 '${key}' 설정이 없습니다.`);
  }

  // 프로바이더의 api_format·base_url 조회 (서비스 롤 — 서버 전용).
  const admin = createAdminClient();
  const { data: provider, error } = await admin
    .from("providers")
    .select("api_format, base_url")
    .eq("id", target.provider_id)
    .maybeSingle();
  if (error) {
    throw new Error(`프로바이더 조회 실패: ${error.message}`);
  }
  if (!provider) {
    throw new Error("지정된 프로바이더를 찾을 수 없습니다.");
  }

  const apiKey = await resolveApiKey(userId, target.provider_id);
  const adapter = ADAPTERS[provider.api_format];
  const baseUrl = provider.base_url ?? DEFAULT_BASE_URLS[provider.api_format];

  return adapter({
    baseUrl,
    apiKey,
    model: target.model,
    messages,
    maxTokens: maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature,
  });
}
