import type { ApiFormat } from "@/lib/supabase/types";

// OCR(추출) 담당 프로바이더·모델 선택용 카탈로그 (세션 5).
// api_format별로 "OCR 가능(비전) 모델"만 제시한다. 교사가 업로드 화면에서 회사+모델을 고른다.
// 모델 ID는 정확한 문자열만 사용한다(날짜 접미사 금지).
//   - anthropic: 프로젝트가 쓰는 Claude 모델(둘 다 비전·PDF 입력 지원). 스캔 PDF도 문서 블록으로 직접 처리.
//   - openai:    비전 가능 모델(이미지만 — chat completions는 PDF 문서 파트 미지원).
//   - google:    Gemini 비전 모델(inlineData로 이미지·PDF 지원).
// 카탈로그에 없는 커스텀 프로바이더는 UI에서 자유 입력으로 폴백한다.
export const VISION_MODELS: Record<ApiFormat, string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  google: ["gemini-2.0-flash", "gemini-1.5-pro"],
};

// 해당 형식에 OCR 카탈로그가 있는지(=드롭다운 제공 가능).
export function hasVisionCatalog(format: ApiFormat): boolean {
  return (VISION_MODELS[format]?.length ?? 0) > 0;
}
