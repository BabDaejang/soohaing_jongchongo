import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RubricEditor } from "@/components/projects/rubric-editor";
import type { RubricCriterion } from "@/lib/supabase/types";

// 루브릭 편집 화면 (SPEC 4·6절). 프로젝트 생성 시 기본 루브릭이 시드되어 있다.
export default async function RubricPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // 프로젝트 접근권 확인(RLS) + 루브릭 조회. 프로젝트가 없으면 404.
  const [projectRes, rubricRes] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("rubrics").select("criteria").eq("project_id", id).maybeSingle(),
  ]);
  if (!projectRes.data) notFound();

  const criteria: RubricCriterion[] = rubricRes.data?.criteria ?? [];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${projectRes.data.id}`}
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

      <RubricEditor projectId={projectRes.data.id} initialCriteria={criteria} />
    </main>
  );
}
