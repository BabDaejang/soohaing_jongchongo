import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StudentList } from "@/components/projects/student-list";
import type { Student } from "@/lib/supabase/types";

// 학생 목록 화면 (SPEC 4·7.4절). 수동 추가/수정/삭제 + 교사 관찰 메모 자동 저장.
// 파일 업로드 기반 학생 생성은 세션 5~6 담당.
export default async function StudentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [projectRes, studentsRes] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", id).maybeSingle(),
    supabase
      .from("students")
      .select("id, project_id, student_number, name, teacher_memo, created_at, updated_at")
      .eq("project_id", id)
      .order("student_number", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true }),
  ]);
  if (!projectRes.data) notFound();

  const students: Student[] = studentsRes.data ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${projectRes.data.id}`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {projectRes.data.name}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">학생 명단</h1>
        <p className="mt-1 text-sm text-zinc-500">
          학생을 직접 추가하거나 정보를 수정합니다. 관찰 메모는 입력하면 자동
          저장됩니다. (파일 업로드로 학생을 불러오는 기능은 이후 제공됩니다.)
        </p>
      </header>

      <StudentList projectId={projectRes.data.id} students={students} />
    </main>
  );
}
