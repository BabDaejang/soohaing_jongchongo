import type { ApiFormat } from "@/lib/supabase/types";

// 키에 저장된 모델 목록(api_keys.models)에서 OCR(이미지·PDF 비전) 가능 모델만 남기는 휴리스틱.
// 보수적 원칙: 확신 없는 모델은 제외하고 [직접 입력] 폴백에 맡긴다.
export function isVisionCapableModel(format: ApiFormat, modelId: string): boolean {
  if (format === "anthropic") return modelId.startsWith("claude-");
  if (format === "google") return modelId.startsWith("gemini-");
  // openai: gpt-4o·gpt-4.x·gpt-4-turbo·gpt-5·chatgpt-4o·o1(=미니 제외)·o3(=미니 제외)·o4 계열이 비전 지원
  return /^(gpt-4o|gpt-4\.|gpt-4-turbo|gpt-5|chatgpt-4o|o1(?!-mini)|o3(?!-mini)|o4)/.test(modelId);
}
