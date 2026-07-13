import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listRoutableProviders } from "@/lib/llm/available";
import { RubricEditor } from "@/components/projects/rubric-editor";
import { RubricModelSelect } from "@/components/projects/rubric/rubric-model-select";
import { RubricPlanPanel } from "@/components/projects/rubric/rubric-plan-panel";
import type { ModelRouting } from "@/lib/llm/types";
import type { RubricCriterion } from "@/lib/supabase/types";

// 루브릭 편집 화면 (SPEC 4·6절, 페이즈 2의 하위 행동). 수동 CRUD + 전담 모델 선택 +
// 평가계획서 AI 분석(diff 승인) + xlsx 다운로드 (리팩토링 2 배치 7).
export default async function RubricPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [projectRes, rubricRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, model_routing")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("rubrics").select("criteria").eq("project_id", id).maybeSingle(),
  ]);
  if (!projectRes.data || !user) notFound();

  const routing = projectRes.data.model_routing as ModelRouting;
  const criteria: RubricCriterion[] = rubricRes.data?.criteria ?? [];
  const providers = await listRoutableProviders(user.id);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${projectRes.data.id}#phase-2`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {projectRes.data.name}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">평가 루브릭</h1>
        <p className="mt-1 text-sm text-zinc-500">
          채점 기준·배점·가중치를 정합니다. 가중치는 합성 방식이 &ldquo;가중&rdquo;일
          때 사용됩니다.
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <RubricModelSelect
          projectId={projectRes.data.id}
          routing={routing}
          providers={providers}
        />

        <RubricPlanPanel
          projectId={projectRes.data.id}
          currentCriteria={criteria}
        />

        {/* 반영·저장으로 기준이 바뀌면 editor를 remount해 최신 기준을 반영한다. */}
        <RubricEditor
          key={criteria.map((c) => c.id).join(",")}
          projectId={projectRes.data.id}
          projectName={projectRes.data.name}
          initialCriteria={criteria}
        />
      </div>
    </main>
  );
}
