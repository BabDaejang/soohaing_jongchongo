import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBriefDraftMessages,
  buildBriefRefineMessages,
  stripCodeFence,
  type BriefDraftInput,
} from "@/lib/prompts/brief";

// 브리프 AI 협업 프롬프트 (리팩토링 4 배치 6, P-8).
// 라이브 LLM은 사용자 체크리스트로 검증하고, 여기서는 **구조**를 고정한다:
// 4개 섹션 지시 · 자기 제약(없는 내용 강조 금지) · 입력 반영 · 빈 항목 미포함.

const FULL: BriefDraftInput = {
  activityName: "자율 동아리 JAYUL 협업 프로젝트",
  description: "모둠별로 주제를 정해 결과물을 만들고 상호 피드백을 진행함",
  emphasis: "협업 과정, 친구 결과물에 대한 판단과 피드백, 상호 발전, 희생·봉사 정신",
  freeText: "학기 말 발표회로 마무리",
  attachedText: "평가계획서: 협업 태도 40%, 산출물 40%, 발표 20%",
};

// ── 초안 프롬프트 ────────────────────────────────────────────────────────
test("초안: 4개 섹션 지시와 자기 제약 문구가 들어간다", () => {
  const [system, user] = buildBriefDraftMessages(FULL);
  const u = String(user.content);
  for (const heading of [
    "# 활동 개요",
    "# 강조 포인트",
    "# 찾아야 할 에피소드 유형",
    "# 서술 지침",
  ]) {
    assert.ok(u.includes(heading), `${heading} 지시 누락`);
  }
  // 자기 제약: 근거 없는 강조를 지시하지 말 것(생성 프롬프트의 우선순위 문구와 짝)
  assert.ok(String(system.content).includes("근거 자료에 없는 내용을 강조하도록 지시하지 말 것"));
});

test("초안: 폼 입력이 라벨과 함께 프롬프트에 실린다", () => {
  const u = String(buildBriefDraftMessages(FULL)[1].content);
  assert.ok(u.includes("[활동명]"));
  assert.ok(u.includes("자율 동아리 JAYUL 협업 프로젝트"));
  assert.ok(u.includes("[강조하고 싶은 포인트]"));
  assert.ok(u.includes("희생·봉사 정신"));
  assert.ok(u.includes("[첨부 자료(평가계획서·활동 안내문 발췌)]"));
  assert.ok(u.includes("협업 태도 40%"));
});

test("초안: 비어 있는 항목은 라벨째 빠진다(빈 항목으로 프롬프트를 채우지 않음)", () => {
  const u = String(
    buildBriefDraftMessages({
      activityName: "독서 활동",
      description: "",
      emphasis: "",
      freeText: "",
      attachedText: "",
    })[1].content,
  );
  assert.ok(u.includes("[활동명]"));
  assert.ok(!u.includes("[활동 설명]"));
  assert.ok(!u.includes("[강조하고 싶은 포인트]"));
  assert.ok(!u.includes("[첨부 자료"));
});

test("초안: 첨부 텍스트는 8000자로 잘린다(프롬프트 폭주 방지)", () => {
  const u = String(
    buildBriefDraftMessages({ ...FULL, attachedText: "가".repeat(9000) })[1].content,
  );
  assert.ok(u.includes("가".repeat(8000)));
  assert.ok(!u.includes("가".repeat(8001)));
});

// ── 다듬기 프롬프트 ──────────────────────────────────────────────────────
test("다듬기: 현재 브리프와 요청이 실리고 '전체 Markdown' 반환을 지시한다", () => {
  const [system, user] = buildBriefRefineMessages(
    "# 활동 개요\n협업 프로젝트",
    "봉사 강조를 더 구체적으로",
  );
  const u = String(user.content);
  assert.ok(u.includes("[현재 브리프]"));
  assert.ok(u.includes("협업 프로젝트"));
  assert.ok(u.includes("[수정 요청]"));
  assert.ok(u.includes("봉사 강조를 더 구체적으로"));
  // 부분 diff가 아니라 전문 — 교사가 최종 형태를 통째로 보고 판단해야 한다.
  assert.ok(String(system.content).includes("전체 Markdown"));
  assert.ok(String(system.content).includes("근거 자료에 없는 내용을 강조하도록 지시하지 말 것"));
});

test("다듬기: 브리프가 비면 '(비어 있음)'으로 표기된다", () => {
  const u = String(buildBriefRefineMessages("   ", "채워 줘")[1].content);
  assert.ok(u.includes("(비어 있음)"));
});

// ── 코드 펜스 제거 ───────────────────────────────────────────────────────
test("stripCodeFence: 모델이 감싼 펜스를 벗기고 본문만 남긴다", () => {
  assert.equal(stripCodeFence("```markdown\n# 제목\n본문\n```"), "# 제목\n본문");
  assert.equal(stripCodeFence("```\n# 제목\n```"), "# 제목");
  // 펜스가 없으면 그대로(앞뒤 공백만 정리)
  assert.equal(stripCodeFence("  # 제목\n본문  "), "# 제목\n본문");
  // 본문 중간의 코드 블록은 건드리지 않는다
  const withInner = "# 제목\n\n```\n예시\n```\n\n끝";
  assert.equal(stripCodeFence(withInner), withInner);
});
