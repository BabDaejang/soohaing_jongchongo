import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderProfileMarkdown,
  parseProfileMarkdown,
} from "@/lib/records/profile-markdown";
import type { ProfileItem } from "@/lib/supabase/types";

const guidelines: ProfileItem[] = [
  { id: "g1", text: "경험 중심으로 서술함." },
  { id: "g2", text: "근거 있는 내용만 씀." },
];
const prohibitions: ProfileItem[] = [{ id: "p1", text: "성명 미표기." }];

test("render: 버전·업데이트 헤더와 두 섹션 포함", () => {
  const md = renderProfileMarkdown(
    { title: "계정 기본", version: 3, updatedLabel: "2026-07-10 14:30" },
    guidelines,
    prohibitions,
  );
  assert.ok(md.includes("버전: v3"));
  assert.ok(md.includes("업데이트: 2026-07-10 14:30"));
  assert.ok(md.includes("## 작성 참고사항"));
  assert.ok(md.includes("## 금지사항"));
  assert.ok(md.includes("1. 경험 중심으로 서술함."));
});

test("parse: 내보낸 MD를 다시 파싱하면 항목 텍스트가 왕복 보존", () => {
  const md = renderProfileMarkdown(
    { title: "계정 기본", version: 3, updatedLabel: "2026-07-10 14:30" },
    guidelines,
    prohibitions,
  );
  const parsed = parseProfileMarkdown(md);
  assert.deepEqual(
    parsed.guidelines.map((g) => g.text),
    ["경험 중심으로 서술함.", "근거 있는 내용만 씀."],
  );
  assert.deepEqual(
    parsed.prohibitions.map((p) => p.text),
    ["성명 미표기."],
  );
  // 메타 불릿(버전/업데이트)은 항목으로 파싱되지 않는다(섹션 밖).
  assert.ok(!parsed.guidelines.some((g) => g.text.startsWith("버전")));
});

test("parse: 번호·불릿 혼용 허용, (없음)·잡음 무시", () => {
  const md = [
    "# 제목",
    "## 작성 참고사항",
    "- 첫째 항목",
    "2) 둘째 항목",
    "잡음 줄(무시)",
    "## 금지사항",
    "(없음)",
  ].join("\n");
  const parsed = parseProfileMarkdown(md);
  assert.deepEqual(
    parsed.guidelines.map((g) => g.text),
    ["첫째 항목", "둘째 항목"],
  );
  assert.equal(parsed.prohibitions.length, 0);
});

test("parse: 섹션이 없으면 빈 목록", () => {
  const parsed = parseProfileMarkdown("아무 텍스트나...\n- 목록이지만 섹션 밖");
  assert.equal(parsed.guidelines.length, 0);
  assert.equal(parsed.prohibitions.length, 0);
});
