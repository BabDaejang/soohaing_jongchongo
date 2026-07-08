import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

// 승인된 사용자의 첫 화면. 프로젝트 목록은 세션 4에서 구현한다 (SPEC 4절).
export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("name, email, role")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">수행평가 수합·평가·생기부</h1>
        <p className="mt-2 text-sm text-zinc-500">
          {profile?.name ?? profile?.email ?? ""} 님, 환영합니다.
        </p>
        <p className="mt-6 rounded-lg border border-dashed border-zinc-300 px-6 py-8 text-sm text-zinc-400 dark:border-zinc-700">
          프로젝트 목록이 여기에 표시됩니다 (세션 4 구현 예정).
        </p>
      </div>
      <nav className="flex items-center gap-4 text-sm">
        <Link
          href="/account"
          className="text-zinc-600 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          계정 옵션
        </Link>
        {profile?.role === "admin" && (
          <Link
            href="/admin"
            className="text-zinc-600 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            관리자 패널
          </Link>
        )}
        <SignOutButton />
      </nav>
    </main>
  );
}
