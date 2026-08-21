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
  briefMd: string = "", // 리팩토링 4 배치 5 — 구 호출부 호환을 위한 기본값
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
    // 브리프는 자유 markdown 원문이라 **마지막 섹션**에 둔다 — 본문 속 `###` 등 하위 헤더가
    // 뒤 섹션을 오염시킬 수 없는 위치다(배치 5, 파싱 한계는 parse 주석 참조).
    "## 활동·작성 브리프",
    "",
    briefMd.trim() !== "" ? briefMd.trim() : "(없음)",
    "",
  ].join("\n");
}

type Section = "none" | "guidelines" | "prohibitions" | "brief";

// 정확히 2단계(`## `) 헤더만 섹션 전환으로 본다(배치 5 개정). 브리프 본문은 자유 markdown이라
// `###` 하위 헤더·`#` 제목을 품을 수 있는데, 이것이 섹션을 끊으면 왕복이 깨진다.
// 알려진 한계: 브리프 본문에 `## …참고…`/`## …금지…` 2단계 헤더가 있으면 섹션 전환으로
// 읽힌다 — 내보내기가 브리프를 문서 마지막에 두므로 정상 왕복에서는 발생하지 않는다.
function h2Section(line: string): Section | null {
  const t = line.trim();
  if (!/^##(?!#)/.test(t)) return null; // ##만(###·#은 아님)
  if (t.includes("참고")) return "guidelines";
  if (t.includes("금지")) return "prohibitions";
  if (t.includes("브리프")) return "brief";
  return "none";
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
  brief: string; // 브리프 섹션 원문(없으면 "" — 구 MD 하위 호환, 배치 5)
} {
  const guidelines: ProfileItem[] = [];
  const prohibitions: ProfileItem[] = [];
  const briefLines: string[] = [];
  let section: Section = "none";
  for (const line of md.split(/\r?\n/)) {
    const h2 = h2Section(line);
    if (h2 !== null) {
      section = h2; // 섹션 헤더 줄 자체는 내용이 아니다
      continue;
    }
    if (section === "brief") {
      briefLines.push(line); // 원문 보존 — 목록·하위 헤더·빈 줄 전부 내용이다
      continue;
    }
    if (line.trim().startsWith("#")) {
      section = "none"; // 참고/금지 목록 구간에서는 기존 관행 유지(다른 헤더 → 구간 종료)
      continue;
    }
    if (section === "none") continue;
    const text = itemText(line);
    if (text === null) continue;
    const item: ProfileItem = { id: crypto.randomUUID(), text };
    if (section === "guidelines") guidelines.push(item);
    else prohibitions.push(item);
  }
  // 앞뒤 빈 줄을 걷어내고, 자리표시 "(없음)"은 빈 브리프로 되돌린다(render와 왕복 일치).
  const brief = briefLines.join("\n").trim();
  return { guidelines, prohibitions, brief: brief === "(없음)" ? "" : brief };
}
