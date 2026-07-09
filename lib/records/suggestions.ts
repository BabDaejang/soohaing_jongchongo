// 예시 생기부 인제스트 제안 (SPEC 7.5). **순수** — LLM 분석 응답을 diff 제안으로 정규화한다.
// 자동 반영 금지: 이 제안은 UI 상태로만 표시되고, 교사가 승인한 항목만 프로필에 반영된다.
import type { ProfileItem } from "@/lib/supabase/types";

export type SuggestionKind = "guideline" | "prohibition";
export type SuggestionAction = "add" | "modify";

export type ProfileSuggestion = {
  kind: SuggestionKind;
  action: SuggestionAction;
  targetId: string | null; // modify일 때 기존 항목 id, add면 null
  text: string;
  before?: string; // modify 대상의 기존 텍스트(diff 표시용)
};

function parseSection(
  raw: unknown,
  kind: SuggestionKind,
  existing: ProfileItem[],
): ProfileSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(existing.map((it) => [it.id, it.text]));
  const out: ProfileSuggestion[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) continue;
    const action: SuggestionAction = rec.action === "modify" ? "modify" : "add";
    // modify는 기존 id가 실제 존재할 때만 유효(환각 id 차단), 아니면 add로 강등.
    const targetId =
      action === "modify" && typeof rec.id === "string" && byId.has(rec.id)
        ? rec.id
        : null;
    out.push({
      kind,
      action: targetId ? "modify" : "add",
      targetId,
      text,
      ...(targetId ? { before: byId.get(targetId) } : {}),
    });
  }
  return out;
}

// LLM 응답에서 { guidelines: [...], prohibitions: [...] } 형태 제안을 추출한다.
export function parseSuggestions(
  text: string,
  current: { guidelines: ProfileItem[]; prohibitions: ProfileItem[] },
): ProfileSuggestion[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const rec = parsed as Record<string, unknown>;
  return [
    ...parseSection(rec.guidelines, "guideline", current.guidelines),
    ...parseSection(rec.prohibitions, "prohibition", current.prohibitions),
  ];
}
