// 작성 브리프 AI 협업 프롬프트 (리팩토링 4 배치 6, P-8). 코드 인라인 금지 → 파일 분리.
// 교사의 폼 입력·첨부 텍스트로 브리프 MD 초안을 만들거나, 현재 브리프를 요청대로 다듬는다.
//
// **자동 반영 금지**: 여기서 만든 출력은 저장 경로가 없다(draftBrief·refineBrief는 DB 쓰기 없음).
// 교사가 편집기에서 확인·수정한 뒤 명시적으로 저장할 때만 새 버전이 된다(배치 5 경로).
import type { LLMMessage } from "@/lib/llm";

// 브리프가 가져야 할 4개 섹션. 생성 프롬프트가 이 MD를 통째로 주입하므로(배치 5),
// 구조가 일정해야 교사가 읽고 고치기 쉽고 모델도 관점을 안정적으로 잡는다.
const BRIEF_SECTIONS = [
  "# 활동 개요 — 이 수행평가/활동의 성격과 목표",
  "# 강조 포인트 — 생기부 서술에서 부각할 역량·태도",
  "# 찾아야 할 에피소드 유형 — 제출물·교사 메모에서 어떤 장면을 찾아 쓸지",
  "# 서술 지침 — 관점, 사실을 엮는 방식, 피할 표현",
].join("\n");

// 브리프가 넘지 말아야 할 선 — 브리프는 '관점'을 정할 뿐 근거 요건을 완화할 수 없다.
// 생성 프롬프트의 우선순위 문구(BRIEF_PRIORITY_LINE)와 짝을 이루는 자기 제약이다.
const SELF_CONSTRAINT =
  "근거 자료에 없는 내용을 강조하도록 지시하지 말 것. 브리프는 무엇을 어떤 관점으로 서술할지를 정할 뿐이며, 없는 사실을 만들어 내라는 지시를 담아서는 안 된다.";

const COMMON_SYSTEM = [
  "너는 대한민국 고등학교 교사의 학교생활기록부(생기부) 작성을 돕는 보조자다.",
  "교사가 준 활동 정보를 바탕으로, 생기부 생성 AI에게 줄 **작성 브리프**를 Markdown으로 쓴다.",
  "브리프는 개별 학생의 서술이 아니라 **활동 전체에 적용할 관점·강조점**을 정하는 문서다.",
  "학생 이름·구체적 성취를 지어내지 않는다 — 브리프에는 특정 학생의 사실이 들어가지 않는다.",
  SELF_CONSTRAINT,
].join("\n");

// 폼에 값이 있을 때만 라벨과 함께 넣는다(빈 항목으로 프롬프트를 채우지 않는다).
function field(label: string, value: string): string[] {
  const v = value.trim();
  return v ? [`[${label}]`, v, ""] : [];
}

export type BriefDraftInput = {
  activityName: string;
  description: string;
  emphasis: string;
  freeText: string;
  attachedText: string; // 평가계획서·활동 안내문에서 서버가 추출한 텍스트
};

export function buildBriefDraftMessages(input: BriefDraftInput): LLMMessage[] {
  const user = [
    ...field("활동명", input.activityName),
    ...field("활동 설명", input.description),
    ...field("강조하고 싶은 포인트", input.emphasis),
    ...field("보충 설명", input.freeText),
    ...field("첨부 자료(평가계획서·활동 안내문 발췌)", input.attachedText.slice(0, 8000)),
    "위 정보를 바탕으로 작성 브리프를 Markdown으로 작성하라.",
    "아래 4개 섹션을 이 순서와 제목으로 포함한다:",
    BRIEF_SECTIONS,
    "",
    "각 섹션은 짧은 문장이나 불릿으로 쓴다. 교사가 그대로 읽고 고칠 수 있도록 간결하게 쓴다.",
    "Markdown 본문만 출력하라 — 코드 펜스·머리말·설명은 붙이지 않는다.",
  ].join("\n");

  return [
    { role: "system", content: COMMON_SYSTEM },
    { role: "user", content: user },
  ];
}

export function buildBriefRefineMessages(
  currentMd: string,
  request: string,
): LLMMessage[] {
  const system = [
    COMMON_SYSTEM,
    "이번에는 기존 브리프를 교사의 요청에 맞게 고친다.",
    // 부분 diff가 아니라 전문을 요구한다 — 교사가 최종 형태를 통째로 보고 판단해야 하고,
    // 조각 병합은 클라이언트에서 또 다른 오적용 여지를 만든다(무자동반영 원칙과 정합).
    "요청과 무관한 부분은 그대로 두고, 수정된 **전체 Markdown**을 출력한다(부분 발췌·diff 금지).",
  ].join("\n");

  const user = [
    "[현재 브리프]",
    currentMd.trim() || "(비어 있음)",
    "",
    "[수정 요청]",
    request.trim(),
    "",
    "수정된 브리프 전문을 Markdown으로만 출력하라 — 코드 펜스·설명·변경 요약은 붙이지 않는다.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// 모델이 습관적으로 감싸는 코드 펜스를 벗긴다(```markdown … ``` / ``` … ```).
// 브리프는 원문 그대로 편집기에 들어가야 하므로 펜스가 남으면 프롬프트에도 그대로 실린다.
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}
