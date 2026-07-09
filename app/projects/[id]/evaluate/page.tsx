import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RunPanel } from "@/components/projects/evaluate/run-panel";
import { ResultsTable, type ScoreRow } from "@/components/projects/evaluate/results-table";

// Phase 2 상대평가 (SPEC 6절). 채점 → 합성 → 순위 → 등급 파생. 등급 직접 수정 없음(INV-6).
export default async function EvaluatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, grading_scheme, tie_break, needs_recalc")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const [studentsRes, scoresRes, matchedRes, evalRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name, score_override, override_reason")
      .eq("project_id", id),
    supabase
      .from("student_scores")
      .select("student_id, composite_score, effective_score")
      .eq("project_id", id),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("include_in_eval", true)
      .not("student_id", "is", null)
      .in("match_status", ["auto_matched", "confirmed"]),
    supabase
      .from("evaluations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("is_current", true),
  ]);

  const students = studentsRes.data ?? [];
  const scoreByStudent = new Map(
    (scoresRes.data ?? []).map((s) => [s.student_id, s]),
  );

  // 순위 대상 = student_scores가 있는 학생(배치가 산출한 스냅샷). 표시용 점수는 파생 재계산.
  const rows: ScoreRow[] = [];
  for (const st of students) {
    const sc = scoreByStudent.get(st.id);
    if (!sc) continue;
    rows.push({
      studentId: st.id,
      name: st.name,
      studentNumber: st.student_number,
      composite: Number(sc.composite_score),
      effective: Number(sc.effective_score),
      override: st.score_override === null ? null : Number(st.score_override),
      overrideReason: st.override_reason,
    });
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">상대평가</h1>
        <p className="mt-1 text-sm text-zinc-500">
          루브릭 기준으로 제출물을 채점하고, 합성 점수로 순위·등급을 파생합니다. 등급은
          직접 수정하지 않고 점수에서 계산되며, 교사 개입은 사유가 필요한{" "}
          <b>점수 보정</b>으로만 가능합니다.
        </p>
      </header>

      <section className="mb-8">
        <RunPanel
          projectId={project.id}
          needsRecalc={project.needs_recalc}
          matchedIncluded={matchedRes.count ?? 0}
          scoredSubmissions={evalRes.count ?? 0}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">순위 · 등급</h2>
        <ResultsTable
          projectId={project.id}
          rows={rows}
          initialScheme={project.grading_scheme}
          tieBreak={project.tie_break}
        />
      </section>
    </main>
  );
}
