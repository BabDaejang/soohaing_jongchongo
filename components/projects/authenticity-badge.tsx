import type { AuthenticityStatus } from "@/lib/supabase/types";

// 진실성 상태 배지 (리팩토링 2 배치 10). 확인/의심/판정 불가만 표시하고,
// 미검증·해당 없음(출처 인용 없음)은 표시하지 않는다(노이즈 절감). 플래그일 뿐 — 자동 조치 없음.
const BADGE: Record<AuthenticityStatus, { label: string; className: string } | null> = {
  unverified: null,
  not_applicable: null,
  verified: {
    label: "확인",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  },
  suspect: {
    label: "의심",
    className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  },
  unverifiable: {
    label: "판정 불가",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
};

export function AuthenticityBadge({ status }: { status: AuthenticityStatus }) {
  const b = BADGE[status];
  if (!b) return null;
  return (
    <span
      className={`ml-1 shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${b.className}`}
    >
      {b.label}
    </span>
  );
}
