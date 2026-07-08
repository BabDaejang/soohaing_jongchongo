import type { ModelRouting, Purpose, RoutingKey } from "./types";

// 용도 → 라우팅 키 매핑. 추출·매칭은 저비용 모델(extract)을 공유한다 (SPEC 3절).
const PURPOSE_TO_KEY: Record<Purpose, RoutingKey> = {
  추출: "extract",
  매칭: "extract",
  평가: "evaluate",
  생성: "generate",
  검증: "verify",
};

export function routingKeyForPurpose(purpose: Purpose): RoutingKey {
  return PURPOSE_TO_KEY[purpose];
}

// 라우팅 키별 기본 모델명 (SPEC 3절: 추출/매칭 haiku, 평가/생성/검증 sonnet).
// 프로젝트 생성 시 model_routing 기본값 조립에 사용한다 (아래 buildDefaultModelRouting).
export const DEFAULT_MODELS: Record<RoutingKey, string> = {
  extract: "claude-haiku-4-5",
  evaluate: "claude-sonnet-4-6",
  generate: "claude-sonnet-4-6",
  verify: "claude-sonnet-4-6",
};

// 프로젝트 model_routing 기본값 조립 (세션 4, DATA_MODEL 5절).
// DEFAULT_MODELS의 각 모델은 전부 claude-* 이므로 anthropic 시드 프로바이더 id 하나에 매핑한다.
// provider_id는 호출부(createProject)가 providers 테이블에서 name='anthropic'으로 조회해 넘긴다.
export function buildDefaultModelRouting(
  anthropicProviderId: string,
): ModelRouting {
  const target = (key: RoutingKey) => ({
    provider_id: anthropicProviderId,
    model: DEFAULT_MODELS[key],
  });
  return {
    extract: target("extract"),
    evaluate: target("evaluate"),
    generate: target("generate"),
    verify: target("verify"),
  };
}
