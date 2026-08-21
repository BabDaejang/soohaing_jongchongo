"use server";

import { requireProjectOwner } from "@/lib/projects";
import { normalizeWorksheetLayout } from "@/lib/worksheet/layout";
import {
  assembleWorksheetRows,
  type SubmissionRaw,
} from "@/lib/worksheet/assemble";
import type { WorksheetRow } from "@/lib/worksheet/types";
import type { UnassignedCount } from "@/lib/worksheet/unassigned";
import type { RubricCriterion } from "@/lib/supabase/types";

// 작업결과표 행 조립(배치 3). requireProjectOwner 후 owner 클라이언트(RLS)로 4쿼리 →
// 순수 assembleWorksheetRows로 학생 기준 left-join 조립. 페이지도 같은 조립 함수를 쓴다.
export async function fetchWorksheetRows(projectId: string): Promise<WorksheetRow[]> {
  const { supabase } = await requireProjectOwner(projectId);

  const [studentsRes, subsRes, scoresRes, recordsRes, evalsRes, rubricRes] =
    await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name, teacher_memo, score_override, override_reason")
      .eq("project_id", projectId),
    // student_id NOT NULL만(귀속분 전부, 상태 무관).
    supabase
      .from("submissions")
      .select("id, student_id, source_filename, submission_key, authenticity_status, content_text, source_type, factsheet_id, authenticity, factsheets(title), match_method, identity_source")
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
    // 현재 채점 결과 — evaluations는 소유자 select가 허용된다(쓰기만 service role 전용).
    supabase
      .from("evaluations")
      .select("submission_id, scores, total_score, origin")
      .eq("project_id", projectId)
      .eq("is_current", true),
    supabase.from("rubrics").select("criteria").eq("project_id", projectId).maybeSingle(),
  ]);

  return assembleWorksheetRows({
    students: studentsRes.data ?? [],
    submissions: (subsRes.data ?? []) as SubmissionRaw[],
    scores: scoresRes.data ?? [],
    records: recordsRes.data ?? [],
    evaluations: evalsRes.data ?? [],
    criteria: (rubricRes.data?.criteria ?? []) as RubricCriterion[],
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

// 미귀속 제출물 카운트 (리팩토링 4 배치 3, P-2).
// fetchWorksheetRows는 `student_id NOT NULL`만 조립하므로 미귀속분은 표에 없다 — 그 존재를
// 배너로 알리기 위한 카운트만 따로 센다. **fetchWorksheetRows의 반환 형태(WorksheetRow[])는
// 건드리지 않는다**(기존 소비자 하위 호환) — 갱신 시 두 액션을 나란히 호출한다.
export async function fetchUnassignedCount(
  projectId: string,
): Promise<UnassignedCount> {
  const { supabase } = await requireProjectOwner(projectId);

  const [unmatchedRes, pendingRes] = await Promise.all([
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("student_id", null)
      .eq("match_status", "unmatched"),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .is("student_id", null)
      .in("match_status", ["pending_confirm", "update_pending"]),
  ]);

  return {
    unmatched: unmatchedRes.count ?? 0,
    pending: pendingRes.count ?? 0,
  };
}
