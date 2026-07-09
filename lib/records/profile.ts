// 프롬프트 프로필 계층 병합 (SPEC 7.5). **순수 함수** — 서버 생성 컨텍스트와 클라이언트 표시가
// 동일 규칙을 쓴다. 계층: 계정 기본(base) → 프로젝트 오버라이드(우선, 뒤에 적용).
// "우선"은 오버라이드 항목을 뒤(최종 지침)에 배치해 모델이 마지막으로 읽게 함을 뜻한다.
import type { ProfileItem } from "@/lib/supabase/types";

export type ProfileItemSource = "account" | "project";

// 병합 결과 항목: 원래 항목 + 어느 계층에서 왔는지 태그(UI 적용 순서 표기용).
export type MergedProfileItem = ProfileItem & { source: ProfileItemSource };

export type MergedProfile = {
  guidelines: MergedProfileItem[];
  prohibitions: MergedProfileItem[];
};

function tag(items: ProfileItem[], source: ProfileItemSource): MergedProfileItem[] {
  return items.map((it) => ({ ...it, source }));
}

// 계정 기본(base)을 먼저, 프로젝트 오버라이드(우선)를 뒤에 이어 붙인다.
// 오버라이드가 없으면(계정 기본만) account 태그 항목만 반환한다.
export function mergeProfileLayers(
  accountDefault: { guidelines: ProfileItem[]; prohibitions: ProfileItem[] } | null,
  projectOverride: { guidelines: ProfileItem[]; prohibitions: ProfileItem[] } | null,
): MergedProfile {
  const baseG = accountDefault ? tag(accountDefault.guidelines, "account") : [];
  const baseP = accountDefault ? tag(accountDefault.prohibitions, "account") : [];
  const ovG = projectOverride ? tag(projectOverride.guidelines, "project") : [];
  const ovP = projectOverride ? tag(projectOverride.prohibitions, "project") : [];
  return {
    guidelines: [...baseG, ...ovG],
    prohibitions: [...baseP, ...ovP],
  };
}
