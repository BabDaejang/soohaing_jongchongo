import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureDefaultProfile } from "./actions";
import { RecordsClient } from "@/components/projects/records/records-client";
import type { StudentRow } from "@/components/projects/records/types";
import type { VerificationSentence } from "@/lib/supabase/types";

// Phase 3 생기부 (SPEC 7절). 학생 1명씩 격리 생성(INV-1)·검증. 컨텍스트는 서버 조립(INV-2).
export default async function RecordsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 계정 기본 프롬프트 프로필을 시드(없을 때만) — 문체 기본값 로드.
  await ensureDefaultProfile();

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, char_limit, count_method")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [studentsRes, recordsRes, subsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name, teacher_memo")
      .eq("project_id", id)
      .order("student_number", { nullsFirst: false })
      .order("name"),
    supabase
      .from("records")
      .select("student_id, version, content, verification, origin, model, created_at")
      .eq("project_id", id)
      .eq("is_current", true),
    supabase
      .from("submissions")
      .select("student_id")
      .eq("project_id", id)
      .eq("include_in_record", true)
      .not("student_id", "is", null)
      .in("match_status", ["auto_matched", "confirmed"]),
  ]);

  const recordByStudent = new Map(
    (recordsRes.data ?? []).map((r) => [r.student_id, r]),
  );
  const reflectCount = new Map<string, number>();
  for (const s of subsRes.data ?? []) {
    if (!s.student_id) continue;
    reflectCount.set(s.student_id, (reflectCount.get(s.student_id) ?? 0) + 1);
  }

  const students: StudentRow[] = (studentsRes.data ?? []).map((st) => {
    const rec = recordByStudent.get(st.id);
    return {
      id: st.id,
      name: st.name,
      studentNumber: st.student_number,
      teacherMemo: st.teacher_memo,
      reflectCount: reflectCount.get(st.id) ?? 0,
      record: rec
        ? {
            version: rec.version,
            content: rec.content,
            verification: (rec.verification as VerificationSentence[] | null) ?? null,
            origin: rec.origin,
            model: rec.model,
            createdAt: rec.created_at,
          }
        : null,
    };
  });

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {project.name}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">생기부 생성</h1>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${project.id}/results`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              결과 표
            </Link>
            <Link
              href={`/projects/${project.id}/profile`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              프롬프트 프로필
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          학생 한 명씩 격리 생성합니다. 반영된 제출물과 교사 관찰 메모에 근거한 내용만
          서술하며, 생성 직후 검증 패스가 근거 없는 문장을 표시합니다.
        </p>
      </header>

      <RecordsClient
        projectId={project.id}
        charLimit={project.char_limit}
        countMethod={project.count_method}
        students={students}
      />
    </main>
  );
}
