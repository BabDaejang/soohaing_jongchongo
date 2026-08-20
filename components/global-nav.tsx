import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { navLinksFor, navRoleFor } from "@/lib/nav";

// 전역 헤더 내비게이션 (리팩토링 4 배치 1, P-6) — app/layout.tsx의 body 최상단에서 렌더된다.
// 비로그인·미승인은 null을 반환해 /login·/waiting 화면을 오염시키지 않는다(접근 제어 자체는
// proxy.ts가 강제한다 — 여기는 표시 판단만).
// 현재 경로 활성 표시는 서버 컴포넌트 한계상 두지 않는다(과설계 금지).
export async function GlobalNav() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();

  const links = navLinksFor(navRoleFor(profile ?? null));
  if (links.length === 0) return null;

  return (
    <header className="sticky top-0 z-40 border-b-4 border-black bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="text-sm font-black uppercase tracking-tight text-black transition-colors hover:text-neo-accent"
        >
          수행평가 수합·평가·생기부
        </Link>
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`border-2 border-black px-3 py-1.5 font-bold shadow-neo-sm transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                l.href === "/admin" ? "bg-neo-muted" : "bg-white"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
