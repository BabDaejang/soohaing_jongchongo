// 프롬프트 프로필 ↔ Markdown 변환 (세션 8a 확장). **순수** — 클라이언트/서버 공용.
// 내보내기: 버전·업데이트 헤더 + 참고/금지 목록을 사람이 읽는 .md로 렌더.
// 가져오기: 편집한 .md를 참고/금지 항목으로 파싱(반영 전 미리보기·확인).
import type { ProfileItem } from "@/lib/supabase/types";

export type ProfileMarkdownMeta = {
  title: string; // 예: "계정 기본" / "프로젝트 오버라이드"
  version: number;
  updatedLabel: string; // 표시용 날짜시간 문자열(호출부에서 포맷)
};

export function renderProfileMarkdown(
  meta: ProfileMarkdownMeta,
  guidelines: ProfileItem[],
  prohibitions: ProfileItem[],
): string {
  const numbered = (items: ProfileItem[]) =>
    items.length > 0
      ? items.map((it, i) => `${i + 1}. ${it.text}`).join("\n")
      : "(없음)";
  return [
    `# 프롬프트 프로필 — ${meta.title}`,
    "",
    `- 버전: v${meta.version}`,
    `- 업데이트: ${meta.updatedLabel}`,
    "",
    "## 작성 참고사항",
    "",
    numbered(guidelines),
    "",
    "## 금지사항",
    "",
    numbered(prohibitions),
    "",
  ].join("\n");
}

type Section = "none" | "guidelines" | "prohibitions";

function sectionOf(line: string, current: Section): Section {
  const t = line.trim();
  if (t.startsWith("##")) {
    if (t.includes("참고")) return "guidelines";
    if (t.includes("금지")) return "prohibitions";
    return "none";
  }
  if (t.startsWith("#")) return "none"; // 제목 등 다른 헤더
  return current;
}

// "1. text" / "- text" / "* text" 에서 본문 텍스트를 뽑는다. 그 외(빈 줄·(없음))는 무시.
function itemText(line: string): string | null {
  const m = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.*\S)\s*$/);
  if (!m) return null;
  const text = m[1].trim();
  if (!text || text === "(없음)") return null;
  return text;
}

export function parseProfileMarkdown(md: string): {
  guidelines: ProfileItem[];
  prohibitions: ProfileItem[];
} {
  const guidelines: ProfileItem[] = [];
  const prohibitions: ProfileItem[] = [];
  let section: Section = "none";
  for (const line of md.split(/\r?\n/)) {
    section = sectionOf(line, section);
    if (line.trim().startsWith("#")) continue; // 헤더 줄 자체는 항목 아님
    if (section === "none") continue;
    const text = itemText(line);
    if (text === null) continue;
    const item: ProfileItem = { id: crypto.randomUUID(), text };
    if (section === "guidelines") guidelines.push(item);
    else prohibitions.push(item);
  }
  return { guidelines, prohibitions };
}
