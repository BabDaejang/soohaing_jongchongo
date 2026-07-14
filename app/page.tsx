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
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 bg-grid-pattern">
      <header className="mb-8 border-4 border-black bg-neo-secondary p-6 shadow-neo-md rotate-[-0.5deg]">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight uppercase">
              수행평가 프로젝트
            </h1>
            <p className="mt-1 text-sm font-bold text-black/80">
              {profile?.name ?? profile?.email ?? ""} 님, 환영합니다. 프로젝트는 하나의 수행평가 단위입니다.
            </p>
          </div>
          <nav className="flex items-center gap-3 text-sm flex-wrap">
            <Link
              href="/account"
              className="border-2 border-black bg-white px-3 py-1.5 font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
            >
              계정 옵션
            </Link>
            {profile?.role === "admin" && (
              <Link
                href="/admin"
                className="border-2 border-black bg-neo-muted px-3 py-1.5 font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                관리자 패널
              </Link>
            )}
            <SignOutButton />
          </nav>
        </div>
      </header>

      <ProjectList projects={projects} />
    </main>
  );
}
