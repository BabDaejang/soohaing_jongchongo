import type { Purpose, RoutingKey } from "./types";

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
// 프로젝트 생성 시 model_routing 기본값 조립에 사용한다 (세션 4에서 provider_id와 결합).
export const DEFAULT_MODELS: Record<RoutingKey, string> = {
  extract: "claude-haiku-4-5",
  evaluate: "claude-sonnet-4-6",
  generate: "claude-sonnet-4-6",
  verify: "claude-sonnet-4-6",
};
