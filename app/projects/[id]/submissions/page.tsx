import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MatchingPanel } from "@/components/projects/submissions/matching-panel";
import { ConfirmQueue, type QueueItem } from "@/components/projects/submissions/confirm-queue";
import { StudentSubmissions, type SubRow } from "@/components/projects/submissions/student-submissions";
import type { Submission } from "@/lib/supabase/types";

// runMatching이 미식별 제출물마다 LLM을 1회 호출한다(최대 20건, 동시 4). 기본 타임아웃으로는 모자란다.
export const maxDuration = 60;

// Phase 1(b) 매칭·확인 큐·제출물 상세 (SPEC 5.2·5.4, INV-5).
export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [studentsRes, submissionsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name")
      .eq("project_id", id)
      .order("student_number", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
    supabase
      .from("submissions")
      .select(
        "id, student_id, source_filename, source_type, content_text, match_status, match_method, identity_source, match_candidates, pending_content, include_in_eval, include_in_record, storage_path, extraction_approved_at, raw_student_no, raw_student_name, created_at",
      )
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const students = studentsRes.data ?? [];
  const submissions = (submissionsRes.data ?? []) as Submission[];

  const unmatchedCount = submissions.filter((s) => s.match_status === "unmatched").length;

  const queue: QueueItem[] = submissions
    .filter((s) => s.match_status === "pending_confirm" || s.match_status === "update_pending")
    .map((s) => ({
      id: s.id,
      source_filename: s.source_filename,
      content_text: s.content_text,
      match_status: s.match_status as "pending_confirm" | "update_pending",
      match_candidates: s.match_candidates,
      pending_content: s.pending_content,
      raw_student_no: s.raw_student_no,
      raw_student_name: s.raw_student_name,
    }));

  const matched: SubRow[] = submissions
    .filter((s) => s.student_id && (s.match_status === "auto_matched" || s.match_status === "confirmed"))
    .map((s) => ({
      id: s.id,
      student_id: s.student_id,
      source_filename: s.source_filename,
      source_type: s.source_type,
      content_text: s.content_text,
      match_method: s.match_method,
      identity_source: s.identity_source,
      include_in_eval: s.include_in_eval,
      include_in_record: s.include_in_record,
      storage_path: s.storage_path,
      extraction_approved_at: s.extraction_approved_at,
    }));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">매칭 · 확인</h1>
        <p className="mt-1 text-sm text-zinc-500">
          업로드된 제출물을 학생에게 귀속시킵니다. 명단과 모호하지 않게 일치하면 자동으로
          귀속하고, 동명이인·식별 불가만 아래 큐에서 확인합니다. 자동 귀속이 틀렸다면 학생별
          제출물에서 다른 학생으로 옮길 수 있습니다.
          <Link
            href={`/projects/${project.id}/ingest`}
            className="ml-1 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← 업로드로
          </Link>
        </p>
      </header>

      <section className="mb-8">
        <MatchingPanel projectId={project.id} unmatchedCount={unmatchedCount} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold">확인 대기 큐 ({queue.length})</h2>
        <ConfirmQueue projectId={project.id} students={students} items={queue} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">학생별 제출물</h2>
        <StudentSubmissions projectId={project.id} students={students} submissions={matched} />
      </section>
    </main>
  );
}
