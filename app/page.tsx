import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { ProjectList } from "@/components/projects/project-list";

// 승인된 사용자의 첫 화면 = 프로젝트 목록 (SPEC 4절). 프로젝트 = 하나의 수행평가 단위.
export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profileRes, projectsRes] = await Promise.all([
    user
      ? supabase
          .from("profiles")
          .select("name, email, role")
          .eq("id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // RLS로 본인 소유 프로젝트만 반환된다.
    supabase
      .from("projects")
      .select("id, name, description")
      .order("created_at", { ascending: false }),
  ]);

  const profile = profileRes.data;
  const projects = projectsRes.data ?? [];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">수행평가 프로젝트</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {profile?.name ?? profile?.email ?? ""} 님, 환영합니다. 프로젝트는
            하나의 수행평가 단위입니다.
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
      </header>

      <ProjectList projects={projects} />
    </main>
  );
}
