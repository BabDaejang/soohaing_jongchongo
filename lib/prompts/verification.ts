// 생기부 검증 프롬프트 (SPEC 7.3). 코드 인라인 금지 → 이 파일에 분리한다.
// 초안을 문장 단위로 분해 → 각 문장을 근거 제출물 id 또는 교사 메모에 매핑 → 근거 없으면 unsupported.
// 응답은 lib/records/verification.ts의 parseVerification이 안전하게 정규화한다.
import type { LLMMessage } from "@/lib/llm";
import type { StudentContext } from "@/lib/records/context";

function evidenceBlock(ctx: StudentContext): string {
  const parts: string[] = [];
  for (const s of ctx.submissions) {
    parts.push(`[제출물] id=${s.id}\n${s.content_text.slice(0, 6000)}`);
  }
  if (ctx.teacherMemo?.trim()) {
    parts.push(`[교사 메모]\n${ctx.teacherMemo.trim()}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "(근거 자료 없음)";
}

export function buildVerificationMessages(
  draft: string,
  ctx: StudentContext,
): LLMMessage[] {
  const validIds = ctx.submissions.map((s) => s.id).join(", ") || "(없음)";

  const system = [
    "너는 생기부 초안의 근거를 검증하는 사실 검증자다.",
    "초안을 문장 단위로 분해하고, 각 문장이 아래 [근거 자료](제출물 또는 교사 메모)에 근거하는지 판정한다.",
    "제출물에 근거하면 그 제출물 id를 source_submission_ids에 담고, 교사 메모에만 근거하면 grounded_by_memo=true로 표시한다.",
    "근거가 없거나 자료를 넘어서는 추측·과장이면 grounded=false로 표시한다.",
    `source_submission_ids에는 반드시 다음 id 중에서만 넣는다: ${validIds}. 목록에 없는 id는 절대 만들지 않는다.`,
  ].join("\n");

  const user = [
    "[근거 자료]",
    evidenceBlock(ctx),
    "",
    "[검증할 초안]",
    draft,
    "",
    "아래 JSON 배열 형식으로만 답하라(설명·다른 텍스트 금지). 초안의 문장 순서를 그대로 따른다:",
    '[{"sentence":"<문장 원문>","grounded":<true|false>,"source_submission_ids":["<제출물 id>"],"grounded_by_memo":<true|false>}]',
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
