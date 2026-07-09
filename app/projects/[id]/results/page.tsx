import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { computeStandings } from "@/lib/grading";
import { normalizeLayout } from "@/lib/records/layout";
import { ResultsGrid } from "@/components/projects/results/results-grid";
import type { ResultRow } from "@/components/projects/results/results-grid";
import type { RecordOrigin } from "@/lib/supabase/types";

// Phase 3 결과 표 (SPEC 8절). 세션 8a의 records를 4열 표로 열람·편집한다.
// 등급은 student_scores 스냅샷에서 파생 계산(INV-6). 레이아웃은 (user, project)로 복원.
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, grading_scheme, tie_break, char_limit, count_method")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [studentsRes, scoresRes, recordsRes, layoutRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name, teacher_memo")
      .eq("project_id", id)
      .order("student_number", { nullsFirst: false })
      .order("name"),
    supabase
      .from("student_scores")
      .select("student_id, effective_score")
      .eq("project_id", id),
    supabase
      .from("records")
      .select("student_id, version, content, origin")
      .eq("project_id", id)
      .eq("is_current", true),
    // RLS(user_id = auth.uid())로 본인 레이아웃만 조회된다.
    supabase
      .from("ui_layouts")
      .select("layout")
      .eq("project_id", id)
      .maybeSingle(),
  ]);

  const students = studentsRes.data ?? [];
  const effByStudent = new Map(
    (scoresRes.data ?? []).map((s) => [s.student_id, Number(s.effective_score)]),
  );
  const recordByStudent = new Map(
    (recordsRes.data ?? []).map((r) => [r.student_id, r]),
  );

  // 등급 파생: 점수 스냅샷이 있는 학생만 순위·등급 계산(평가 화면과 동일 순수 함수, INV-6).
  const scored = students.filter((st) => effByStudent.has(st.id));
  const standings = computeStandings(
    scored.map((st) => effByStudent.get(st.id) ?? 0),
    project.grading_scheme,
    project.tie_break,
  );
  const gradeByStudent = new Map<string, number>();
  scored.forEach((st, i) => gradeByStudent.set(st.id, standings[i].grade));

  const rows: ResultRow[] = students.map((st) => {
    const rec = recordByStudent.get(st.id);
    return {
      studentId: st.id,
      name: st.name,
      studentNumber: st.student_number,
      grade: gradeByStudent.get(st.id) ?? null,
      teacherMemo: st.teacher_memo ?? "",
      record: rec
        ? {
            version: rec.version,
            content: rec.content,
            origin: rec.origin as RecordOrigin,
          }
        : null,
    };
  });

  const initialLayout = normalizeLayout(
    layoutRes.data?.layout ?? null,
    rows.map((r) => r.studentId),
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {project.name}
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">결과 표</h1>
          <Link
            href={`/projects/${project.id}/records`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            생기부 생성
          </Link>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          학생별 등급·교사 관찰 메모·생성된 생기부를 한 표에서 열람하고 편집합니다.
          열 너비와 셀 표시 방식은 저장되어 다시 들어오면 복원됩니다.
        </p>
      </header>

      <ResultsGrid
        projectId={project.id}
        charLimit={project.char_limit}
        countMethod={project.count_method}
        rows={rows}
        initialLayout={initialLayout}
      />
    </main>
  );
}
