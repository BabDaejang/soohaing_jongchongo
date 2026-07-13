// 평가계획서 분석 프롬프트 (리팩토링 2 배치 7). 코드 인라인 금지 → 파일 분리.
// 교사가 올린 평가계획서 텍스트에서 채점 기준을 추출해 JSON 배열로 제안한다.
// 응답은 서버(analyzeRubricPlan)가 파싱·클램프하며, 자동 저장하지 않는다(교사 승인 필수).
import type { LLMMessage } from "@/lib/llm";

export function buildRubricPlanMessages(planText: string): LLMMessage[] {
  const system = [
    "너는 수행평가 평가계획서에서 채점 루브릭을 뽑아내는 보조자다.",
    "교사가 제시한 평가계획서 텍스트를 읽고, 채점에 쓸 평가 기준을 2~8개로 정리한다.",
    "각 기준은 name(기준 이름), description(무엇을 보는지 한 문장), max_score(만점, 1~100 정수), weight(가중치, 0 이상 숫자)를 가진다.",
    "계획서에 배점이 명시돼 있으면 그 값을 max_score로, 없으면 10으로 둔다. 가중치가 없으면 1로 둔다.",
    "계획서에 없는 기준을 창작하지 말고, 텍스트에 근거한 기준만 제시한다.",
  ].join("\n");

  const user = [
    "[평가계획서]",
    planText.slice(0, 8000),
    "",
    "아래 JSON 배열 형식으로만 답하라(설명·다른 텍스트 금지):",
    '[{"name":"<기준 이름>","description":"<한 문장 설명>","max_score":<정수>,"weight":<숫자>}]',
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
