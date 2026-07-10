import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireApproved } from "@/lib/auth";
import { listRoutableProviders } from "@/lib/llm/available";
import { SettingsForm } from "@/components/projects/settings-form";
import { ModelRoutingForm } from "@/components/projects/model-routing-form";

// 프로젝트 설정 화면 (SPEC 4절). 저장→revalidate로 재로드 왕복.
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await requireApproved();
  const supabase = await createClient();

  // 라우팅 후보는 "이 사용자가 쓸 수 있는 키가 있는 프로바이더"다 (개인 키 우선, 없으면 기본 키).
  const [{ data: project }, providers] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, name, grading_scheme, char_limit, count_method, score_aggregation, tie_break, file_retention_days, model_routing",
      )
      .eq("id", id)
      .maybeSingle(),
    listRoutableProviders(userId),
  ]);
  if (!project) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">프로젝트 설정</h1>
        <p className="mt-1 text-sm text-zinc-500">
          평가·생기부 규칙을 정합니다. 저장하면 즉시 반영됩니다.
        </p>
      </header>

      <SettingsForm project={project} />

      <div className="mt-8">
        <ModelRoutingForm
          projectId={project.id}
          routing={project.model_routing}
          providers={providers}
        />
      </div>
    </main>
  );
}
