// 생기부 생성 프롬프트 (SPEC 7.1). 코드 인라인 금지 → 이 파일에 분리한다.
// 경험 중심 서술(동기→과정·노력·사고→결과→배움), 근거 기반만, 프로필 문체·금지 규칙 적용.
// 학생 성명은 프롬프트에 포함하지 않는다(금지 규칙·혼입 방지 — 이름 없이도 서술 가능).
import type { LLMMessage } from "@/lib/llm";
import type { StudentContext } from "@/lib/records/context";
import type { CountMethod } from "@/lib/supabase/types";

const COUNT_LABEL: Record<CountMethod, string> = {
  chars: "글자수(공백 포함)",
  bytes: "바이트(한글 3바이트)",
};

function itemList(items: { text: string }[]): string {
  if (items.length === 0) return "(없음)";
  return items.map((it, i) => `${i + 1}. ${it.text}`).join("\n");
}

// 활동·작성 관점 브리프 섹션 (리팩토링 4 배치 5, P-7). 빈 문자열이면 **섹션 자체를 생략**한다
// — 프롬프트에 빈 헤더를 남기면 모델이 의미를 추측하게 되므로. 반환 배열 끝의 빈 문자열이
// 다음 섹션과의 빈 줄 간격을 만든다.
function briefSection(brief: string): string[] {
  const b = brief.trim();
  if (!b) return [];
  return ["[활동·작성 관점 브리프]", b, ""];
}

// 브리프가 있을 때만 system에 넣는 우선순위 문구 — 브리프는 서술의 관점을 바꿀 뿐,
// 근거 요건(할루시네이션 가드)을 완화하지 않는다는 명문화(리팩토링 4 공통 원칙, P-7).
const BRIEF_PRIORITY_LINE =
  "브리프는 서술의 관점·강조점을 정한다. 단, 근거 요건보다 우선하지 않는다 — 브리프가 강조하는 내용이라도 근거 자료에 없으면 서술하지 않는다.";

// 제출물을 id와 함께 번호 매겨 근거로 제시한다(검증 패스가 문장→id로 매핑할 수 있도록).
function evidenceBlock(ctx: StudentContext): string {
  if (ctx.submissions.length === 0) return "(반영된 제출물 없음)";
  return ctx.submissions
    .map(
      (s, i) =>
        `[제출물 ${i + 1}] id=${s.id}\n${s.content_text.slice(0, 6000)}`,
    )
    .join("\n\n");
}

export function buildGenerationMessages(ctx: StudentContext): LLMMessage[] {
  const system = [
    "너는 대한민국 고등학교 교사를 돕는 학교생활기록부(생기부) 작성 보조자다.",
    "아래 [근거 자료]와 [교사 관찰 메모]에 **근거가 있는 내용만** 서술한다. 근거 없는 추측·과장·창작은 절대 금지한다.",
    "서술은 산출물 요약이 아니라 **학생의 경험 중심**으로 구성한다: 동기 → 과정·노력·사고 과정 → 결과 → 배움·변화.",
    "아래 [작성 참고사항]과 [금지사항]을 모두 지킨다. 참고/금지 항목은 계정 기본 다음에 프로젝트 오버라이드가 우선한다.",
    ...(ctx.brief.trim() ? [BRIEF_PRIORITY_LINE] : []),
  ].join("\n");

  const user = [
    ...briefSection(ctx.brief),
    "[작성 참고사항]",
    itemList(ctx.guidelines),
    "",
    "[금지사항]",
    itemList(ctx.prohibitions),
    "",
    `[분량 목표] ${ctx.charLimit} ${COUNT_LABEL[ctx.countMethod]} 이내로 작성한다.`,
    "",
    "[근거 자료] — 이 학생의 반영 제출물이며, 여기 있는 사실만 서술 근거로 삼는다.",
    evidenceBlock(ctx),
    "",
    "[교사 관찰 메모]",
    ctx.teacherMemo?.trim() ? ctx.teacherMemo.trim() : "(없음)",
    "",
    "위 근거만으로 생기부 본문을 작성하라. 본문 텍스트만 출력하고, 제목·머리말·설명·따옴표는 붙이지 않는다.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// 단일 문장 재생성 프롬프트 (SPEC 7.3, 문장별 재생성). 기존 문장을 근거 기반으로 다시 쓴다.
export function buildSentenceRegenMessages(
  ctx: StudentContext,
  sentence: string,
): LLMMessage[] {
  const system = [
    "너는 생기부 문장을 근거 기반으로 다시 쓰는 보조자다.",
    "아래 [근거 자료]와 [교사 관찰 메모]에 근거가 있는 내용만으로 주어진 문장을 자연스럽게 한 문장으로 다시 쓴다.",
    "근거 없는 추측·과장은 금지하며, 종결어미는 '-함/-임/-됨' 개조식을 따른다. 학생 성명·인칭은 쓰지 않는다.",
    ...(ctx.brief.trim() ? [BRIEF_PRIORITY_LINE] : []),
  ].join("\n");

  const user = [
    ...briefSection(ctx.brief),
    "[작성 참고사항]",
    itemList(ctx.guidelines),
    "",
    "[금지사항]",
    itemList(ctx.prohibitions),
    "",
    "[근거 자료]",
    evidenceBlock(ctx),
    "",
    "[교사 관찰 메모]",
    ctx.teacherMemo?.trim() ? ctx.teacherMemo.trim() : "(없음)",
    "",
    "[다시 쓸 문장]",
    sentence,
    "",
    "다시 쓴 문장 하나만 출력하라. 설명·따옴표·번호를 붙이지 않는다.",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
