"use server";

import { requireProjectOwner } from "@/lib/projects";
import { normalizeWorksheetLayout } from "@/lib/worksheet/layout";
import { assembleWorksheetRows } from "@/lib/worksheet/assemble";
import type { WorksheetRow } from "@/lib/worksheet/types";

// 작업결과표 행 조립(배치 3). requireProjectOwner 후 owner 클라이언트(RLS)로 4쿼리 →
// 순수 assembleWorksheetRows로 학생 기준 left-join 조립. 페이지도 같은 조립 함수를 쓴다.
export async function fetchWorksheetRows(projectId: string): Promise<WorksheetRow[]> {
  const { supabase } = await requireProjectOwner(projectId);

  const [studentsRes, subsRes, scoresRes, recordsRes] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name, teacher_memo, score_override, override_reason")
      .eq("project_id", projectId),
    // student_id NOT NULL만(귀속분 전부, 상태 무관).
    supabase
      .from("submissions")
      .select("id, student_id, source_filename, submission_key, authenticity_status, content_text, source_type")
      .eq("project_id", projectId)
      .not("student_id", "is", null),
    supabase
      .from("student_scores")
      .select("student_id, display_score, grade")
      .eq("project_id", projectId),
    supabase
      .from("records")
      .select("student_id, content, version")
      .eq("project_id", projectId)
      .eq("is_current", true),
  ]);

  return assembleWorksheetRows({
    students: studentsRes.data ?? [],
    submissions: subsRes.data ?? [],
    scores: scoresRes.data ?? [],
    records: recordsRes.data ?? [],
  });
}

// 레이아웃 저장. ui_layouts (user_id, project_id)당 1행 upsert.
// 신뢰 경계: 서버가 프로젝트 학생 목록 기준으로 normalizeWorksheetLayout 재정규화.
export async function saveWorksheetLayout(
  projectId: string,
  layout: unknown,
): Promise<void> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const { data: students } = await supabase
    .from("students")
    .select("id")
    .eq("project_id", projectId);
  const studentIds = (students ?? []).map((s) => s.id);

  const normalized = normalizeWorksheetLayout(layout, studentIds);

  const { error } = await supabase.from("ui_layouts").upsert(
    {
      user_id: userId,
      project_id: projectId,
      layout: normalized,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,project_id" },
  );
  if (error) throw new Error(`작업결과표 레이아웃 저장 실패: ${error.message}`);
}
