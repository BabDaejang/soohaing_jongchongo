import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureDefaultProfile } from "../records/actions";
import { ProfileEditor } from "@/components/projects/profile/profile-editor";
import { ExampleIngest } from "@/components/projects/profile/example-ingest";
import type { ProfileItem } from "@/lib/supabase/types";

type LayerItems = { guidelines: ProfileItem[]; prohibitions: ProfileItem[] };

const EMPTY: LayerItems = { guidelines: [], prohibitions: [] };

// 프롬프트 프로필 화면 (SPEC 7.5). 계정 기본 + 프로젝트 오버라이드 통합 편집 + 예시 인제스트.
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  await ensureDefaultProfile();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  // 본인 소유 프로필만 RLS로 조회된다(owner_id = auth.uid()).
  const { data: profiles } = await supabase
    .from("prompt_profiles")
    .select("project_id, guidelines, prohibitions")
    .eq("owner_id", user.id)
    .or(`project_id.is.null,project_id.eq.${id}`);

  const accountRow = (profiles ?? []).find((p) => p.project_id === null);
  const projectRow = (profiles ?? []).find((p) => p.project_id === id);

  const account: LayerItems = accountRow
    ? {
        guidelines: accountRow.guidelines as ProfileItem[],
        prohibitions: accountRow.prohibitions as ProfileItem[],
      }
    : EMPTY;
  const projectItems: LayerItems = projectRow
    ? {
        guidelines: projectRow.guidelines as ProfileItem[],
        prohibitions: projectRow.prohibitions as ProfileItem[],
      }
    : EMPTY;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${project.id}/records`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 생기부 생성
        </Link>
        <h1 className="mt-3 text-2xl font-bold">프롬프트 프로필</h1>
        <p className="mt-1 text-sm text-zinc-500">
          생기부 생성에 적용할 작성 참고사항과 금지사항을 관리합니다. 계정 기본은 모든
          프로젝트에 적용되고, 프로젝트 오버라이드가 그 뒤에 우선 적용됩니다.
        </p>
      </header>

      <section className="mb-8">
        <ProfileEditor
          projectId={project.id}
          account={account}
          project={projectItems}
        />
      </section>

      <section>
        <ExampleIngest projectId={project.id} />
      </section>
    </main>
  );
}
