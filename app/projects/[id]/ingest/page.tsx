import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IngestClient } from "@/components/projects/ingest/ingest-client";
import { OcrModelSelect } from "@/components/projects/ingest/ocr-model-select";
import { StagedSubmissions } from "@/components/projects/ingest/staged-submissions";
import type { Project, Provider, Submission } from "@/lib/supabase/types";

// Phase 1(a) 수합 화면 (SPEC 5.1·5.3). 업로드→파싱→스테이징. 매칭은 세션 6.
export default async function IngestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, model_routing")
    .eq("id", id)
    .maybeSingle();
  if (!project || !user) notFound();

  const [providersRes, submissionsRes] = await Promise.all([
    supabase
      .from("providers")
      .select("id, name, api_format")
      .order("created_at", { ascending: true }),
    supabase
      .from("submissions")
      .select(
        "id, source_filename, source_type, match_status, content_text, raw_student_no, raw_student_name, created_at",
      )
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const providers = (providersRes.data ?? []) as Pick<
    Provider,
    "id" | "name" | "api_format"
  >[];
  const submissions = (submissionsRes.data ?? []) as Array<
    Pick<
      Submission,
      | "id"
      | "source_filename"
      | "source_type"
      | "match_status"
      | "content_text"
      | "raw_student_no"
      | "raw_student_name"
      | "created_at"
    >
  >;
  const extract = (project as Pick<Project, "model_routing">).model_routing.extract;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">Phase 1 · 수합</h1>
        <p className="mt-1 text-sm text-zinc-500">
          학생 산출물을 업로드하면 텍스트를 추출해 제출물 후보로 만듭니다. 학생
          매칭은 다음 단계에서 확정합니다. 원본 파일은 추출 확인 전까지 임시
          보관됩니다.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">OCR(스캔·이미지) 모델</h2>
        <OcrModelSelect
          projectId={project.id}
          providers={providers}
          extract={extract}
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-2 text-sm font-semibold">파일 업로드</h2>
        <IngestClient
          projectId={project.id}
          ownerId={user.id}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          수합된 제출물 후보 ({submissions.length})
        </h2>
        <StagedSubmissions submissions={submissions} />
      </section>
    </main>
  );
}
