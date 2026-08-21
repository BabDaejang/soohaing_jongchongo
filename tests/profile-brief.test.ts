import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeProfileLayers } from "@/lib/records/profile";
import {
  buildGenerationMessages,
  buildSentenceRegenMessages,
} from "@/lib/prompts/generation";
import {
  renderProfileMarkdown,
  parseProfileMarkdown,
} from "@/lib/records/profile-markdown";
import type { StudentContext } from "@/lib/records/context";
import type { ProfileItem } from "@/lib/supabase/types";

// 작성 브리프 (리팩토링 4 배치 5, P-7).
// ① 병합: 오버라이드가 비어 있지 않으면 그것만(이어 붙이지 않음 — 활동 맥락 혼입 방지).
// ② 주입: 브리프가 있으면 [활동·작성 관점 브리프] 섹션 + 근거 요건 우선 문구, 없으면 둘 다 생략.
// ③ MD 왕복: 브리프 원문 무손실, 브리프 없는 구 MD 하위 호환.

const items = {
  guidelines: [{ id: "g1", text: "경험 중심" }] as ProfileItem[],
  prohibitions: [{ id: "p1", text: "성명 미표기" }] as ProfileItem[],
};

// ── 병합 규칙 ────────────────────────────────────────────────────────────
test("병합: 오버라이드 브리프가 있으면 그것만 쓴다(계정 기본과 이어 붙이지 않음)", () => {
  const merged = mergeProfileLayers(
    { ...items, brief_md: "계정 공통 브리프" },
    { ...items, brief_md: "JAYUL 활동 — 협업·희생·봉사 강조" },
  );
  assert.equal(merged.brief, "JAYUL 활동 — 협업·희생·봉사 강조");
});

test("병합: 오버라이드 브리프가 공백뿐이면 계정 기본으로 폴백", () => {
  const merged = mergeProfileLayers(
    { ...items, brief_md: "계정 공통 브리프" },
    { ...items, brief_md: "  \n\t " },
  );
  assert.equal(merged.brief, "계정 공통 브리프");
});

test("병합: 양쪽 다 비면 빈 문자열(구 데이터·brief_md 미전달 호환)", () => {
  assert.equal(mergeProfileLayers({ ...items }, { ...items }).brief, "");
  assert.equal(mergeProfileLayers(null, null).brief, "");
});

test("병합: 기존 참고/금지 병합(계정 먼저·오버라이드 뒤)은 불변", () => {
  const merged = mergeProfileLayers(
    { ...items, brief_md: "b" },
    { guidelines: [{ id: "g2", text: "추가" }], prohibitions: [], brief_md: "" },
  );
  assert.deepEqual(
    merged.guidelines.map((g) => [g.id, g.source]),
    [
      ["g1", "account"],
      ["g2", "project"],
    ],
  );
});

// ── 프롬프트 주입 ────────────────────────────────────────────────────────
function ctxWith(brief: string): StudentContext {
  return {
    studentId: "S",
    studentName: "학생",
    projectId: "P",
    submissions: [{ id: "sub1", content_text: "독서 감상문 본문", source_type: "docx" }],
    teacherMemo: null,
    guidelines: [],
    prohibitions: [],
    brief,
    charLimit: 500,
    countMethod: "chars",
  };
}

test("생성 프롬프트: 브리프가 있으면 섹션이 참고사항 앞에 오고 system에 우선순위 문구", () => {
  const [system, user] = buildGenerationMessages(ctxWith("협업 과정을 강조"));
  const u = String(user.content);
  assert.ok(u.includes("[활동·작성 관점 브리프]\n협업 과정을 강조"));
  assert.ok(
    u.indexOf("[활동·작성 관점 브리프]") < u.indexOf("[작성 참고사항]"),
    "브리프 섹션이 참고사항보다 앞",
  );
  assert.ok(String(system.content).includes("근거 요건보다 우선하지 않는다"));
});

test("생성 프롬프트: 브리프가 비면 섹션·우선순위 문구 둘 다 생략", () => {
  const [system, user] = buildGenerationMessages(ctxWith("  "));
  assert.ok(!String(user.content).includes("브리프"));
  assert.ok(!String(system.content).includes("브리프"));
});

test("문장 재생성 프롬프트에도 브리프 섹션·문구가 들어간다", () => {
  const [system, user] = buildSentenceRegenMessages(ctxWith("봉사 관점"), "원 문장.");
  assert.ok(String(user.content).includes("[활동·작성 관점 브리프]\n봉사 관점"));
  assert.ok(String(system.content).includes("근거 요건보다 우선하지 않는다"));
  const [sys2, user2] = buildSentenceRegenMessages(ctxWith(""), "원 문장.");
  assert.ok(!String(user2.content).includes("브리프"));
  assert.ok(!String(sys2.content).includes("브리프"));
});

// ── MD 왕복 ──────────────────────────────────────────────────────────────
const meta = { title: "프로젝트 오버라이드", version: 2, updatedLabel: "2026-08-20 10:00" };

test("MD 왕복: 하위 헤더(###)·목록·빈 줄을 품은 브리프가 무손실로 돌아온다", () => {
  const brief = [
    "### 활동 개요",
    "자율 동아리 JAYUL — 협업 프로젝트.",
    "",
    "### 강조 포인트",
    "- 협업·피드백 과정",
    "- 공동체를 위한 희생과 봉사",
  ].join("\n");
  const md = renderProfileMarkdown(meta, items.guidelines, items.prohibitions, brief);
  const parsed = parseProfileMarkdown(md);
  assert.equal(parsed.brief, brief);
  // 브리프 속 목록(- 협업…)이 참고/금지 항목으로 새지 않는다.
  assert.deepEqual(
    parsed.guidelines.map((g) => g.text),
    ["경험 중심"],
  );
  assert.deepEqual(
    parsed.prohibitions.map((p) => p.text),
    ["성명 미표기"],
  );
});

test("MD 왕복: 빈 브리프는 '(없음)'으로 렌더되고 다시 빈 문자열로 파싱된다", () => {
  const md = renderProfileMarkdown(meta, items.guidelines, items.prohibitions, "");
  assert.ok(md.includes("## 활동·작성 브리프"));
  assert.ok(md.includes("(없음)"));
  assert.equal(parseProfileMarkdown(md).brief, "");
});

test("MD 하위 호환: 브리프 섹션이 없는 구 MD는 brief=''로 파싱되고 항목은 그대로", () => {
  const oldMd = [
    "# 프롬프트 프로필 — 계정 기본",
    "",
    "## 작성 참고사항",
    "",
    "1. 경험 중심",
    "",
    "## 금지사항",
    "",
    "1. 성명 미표기",
  ].join("\n");
  const parsed = parseProfileMarkdown(oldMd);
  assert.equal(parsed.brief, "");
  assert.deepEqual(
    parsed.guidelines.map((g) => g.text),
    ["경험 중심"],
  );
  assert.deepEqual(
    parsed.prohibitions.map((p) => p.text),
    ["성명 미표기"],
  );
});

test("MD 왕복: render 기본값(브리프 인자 생략)은 구 호출부와 호환된다", () => {
  const md = renderProfileMarkdown(meta, items.guidelines, items.prohibitions);
  assert.ok(md.includes("## 활동·작성 브리프"));
  assert.equal(parseProfileMarkdown(md).brief, "");
});
