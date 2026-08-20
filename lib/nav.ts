// 전역 내비게이션 링크 결정 (리팩토링 4 배치 1, P-6).
// GlobalNav는 서버 컴포넌트라 단위 테스트가 어렵다 — 분기 로직만 순수 함수로 떼어 테스트한다.
// server-only가 아니다(순수 계산이라 클라이언트 번들에 섞여도 안전).

export type NavLink = { href: string; label: string };

// 승인 사용자 공통 목적지. /factsheets는 페이즈 2 종속이 아니라 1급 목적지다(P-6).
const BASE_LINKS: NavLink[] = [
  { href: "/", label: "프로젝트" },
  { href: "/factsheets", label: "팩트시트" },
  { href: "/account", label: "계정" },
];

const ADMIN_LINK: NavLink = { href: "/admin", label: "관리자" };

// 내비에 쓸 실효 role. 비로그인(profile=null)·미승인은 null — 내비 자체를 감춘다
// (로그인·대기 화면 오염 금지). 승인 사용자만 자신의 role을 얻는다.
export function navRoleFor(
  profile: { role: string; status: string } | null,
): string | null {
  if (!profile || profile.status !== "approved") return null;
  return profile.role;
}

// role별 링크 목록. null(비로그인·미승인)이면 빈 배열 = 내비 미표시.
export function navLinksFor(role: string | null): NavLink[] {
  if (role === null) return [];
  return role === "admin" ? [...BASE_LINKS, ADMIN_LINK] : [...BASE_LINKS];
}
