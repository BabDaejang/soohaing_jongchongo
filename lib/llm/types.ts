// LLM 통합 클라이언트 공용 타입 (SPEC 3절). 서버 전용 모듈에서만 사용.
import type { ApiFormat } from "@/lib/supabase/types";

export type LLMRole = "system" | "user" | "assistant";

export type LLMMessage = {
  role: LLMRole;
  content: string;
};

// 생기부 파이프라인 용도 (SPEC 3·6·7절). 매칭은 추출과 같은 저비용 라우팅 키를 쓴다.
export type Purpose = "추출" | "매칭" | "평가" | "생성" | "검증";

// 프로젝트 model_routing의 키 (DATA_MODEL 5절: {extract, evaluate, generate, verify}).
export type RoutingKey = "extract" | "evaluate" | "generate" | "verify";

// 라우팅 대상: 어떤 프로바이더의 어떤 모델을 쓸지.
export type ModelTarget = {
  provider_id: string;
  model: string;
};

export type ModelRouting = Record<RoutingKey, ModelTarget>;

export type LLMResult = {
  text: string;
  model: string;
  raw: unknown; // 감사·디버깅용 원문 응답 (SPEC 6절 raw_llm_output는 호출부에서 보관)
};

// 어댑터 공통 입력. api_format별 요청/응답 차이는 각 어댑터가 흡수한다.
export type AdapterParams = {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  maxTokens: number;
  temperature?: number;
};

export type Adapter = (params: AdapterParams) => Promise<LLMResult>;

// api_format별 기본 엔드포인트 (providers.base_url이 NULL일 때 사용).
export const DEFAULT_BASE_URLS: Record<ApiFormat, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com",
};

export const DEFAULT_MAX_TOKENS = 8192;
