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
  brief: string; // 병합된 작성 브리프(리팩토링 4 배치 5, P-7)
};

// 병합 입력 계층. brief_md는 0015 이전 호출부·테스트 픽스처 호환을 위해 선택 필드다.
export type ProfileLayerInput = {
  guidelines: ProfileItem[];
  prohibitions: ProfileItem[];
  brief_md?: string | null;
};

function tag(items: ProfileItem[], source: ProfileItemSource): MergedProfileItem[] {
  return items.map((it) => ({ ...it, source }));
}

// 계정 기본(base)을 먼저, 프로젝트 오버라이드(우선)를 뒤에 이어 붙인다.
// 오버라이드가 없으면(계정 기본만) account 태그 항목만 반환한다.
// **brief는 목록과 달리 이어 붙이지 않는다**: 오버라이드가 공백 제거 후 비어 있지 않으면
// 그것만 쓴다(P-7). 활동 맥락은 프로젝트마다 다르므로 두 브리프가 겹쳐 읽히면 안 된다.
export function mergeProfileLayers(
  accountDefault: ProfileLayerInput | null,
  projectOverride: ProfileLayerInput | null,
): MergedProfile {
  const baseG = accountDefault ? tag(accountDefault.guidelines, "account") : [];
  const baseP = accountDefault ? tag(accountDefault.prohibitions, "account") : [];
  const ovG = projectOverride ? tag(projectOverride.guidelines, "project") : [];
  const ovP = projectOverride ? tag(projectOverride.prohibitions, "project") : [];
  const ovBrief = (projectOverride?.brief_md ?? "").trim();
  const baseBrief = (accountDefault?.brief_md ?? "").trim();
  return {
    guidelines: [...baseG, ...ovG],
    prohibitions: [...baseP, ...ovP],
    brief: ovBrief !== "" ? ovBrief : baseBrief,
  };
}
