// 예시 생기부 인제스트 프롬프트 (SPEC 7.5, 프롬프트 업그레이드). 코드 인라인 금지 → 파일 분리.
// 교사가 입력한 좋은 예시 텍스트를 분석해 참고/금지 항목의 추가·수정안을 diff로 제안한다.
// 응답은 lib/records/suggestions.ts의 parseSuggestions가 정규화하며, 자동 반영하지 않는다.
import type { LLMMessage } from "@/lib/llm";
import type { ProfileItem } from "@/lib/supabase/types";

function itemList(items: ProfileItem[]): string {
  if (items.length === 0) return "(없음)";
  return items.map((it) => `- id:${it.id} | ${it.text}`).join("\n");
}

export function buildExampleAnalysisMessages(
  exampleText: string,
  current: { guidelines: ProfileItem[]; prohibitions: ProfileItem[] },
): LLMMessage[] {
  const system = [
    "너는 생기부 작성 지침을 다듬는 보조자다.",
    "교사가 제시한 예시 생기부의 문체·구성·표현 특징을 분석해, 기존 '작성 참고사항'과 '금지사항'에 반영할 추가·수정안을 제안한다.",
    "새 항목은 action=add, 기존 항목 개선은 action=modify와 그 항목의 id를 함께 제시한다.",
    "예시 자체를 복붙하지 말고, 일반화된 작성 지침 문장으로 제안한다. 제안은 간결한 한 문장으로 한다.",
  ].join("\n");

  const user = [
    "[기존 작성 참고사항]",
    itemList(current.guidelines),
    "",
    "[기존 금지사항]",
    itemList(current.prohibitions),
    "",
    "[예시 생기부]",
    exampleText.slice(0, 8000),
    "",
    "아래 JSON 형식으로만 답하라(설명·다른 텍스트 금지). 제안이 없으면 빈 배열로 둔다:",
    '{"guidelines":[{"action":"add|modify","id":"<modify일 때 기존 id>","text":"<제안 문장>"}],"prohibitions":[{"action":"add|modify","id":"<기존 id>","text":"<제안 문장>"}]}',
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
