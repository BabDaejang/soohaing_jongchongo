"use server";

import { requireProjectOwner } from "@/lib/projects";
import { normalizeLayout } from "@/lib/records/layout";

// 결과 표 레이아웃 저장 (SPEC 8절). (user_id, project_id)당 1행 upsert(디바운스는 클라이언트).
// 신뢰 경계: 클라이언트가 보낸 layout을 서버가 프로젝트 학생 목록 기준으로 재정규화한다
//   (열 너비 클램프·존재하지 않는 학생 셀 제거). RLS는 user_id = auth.uid()만 허용.
export async function saveLayout(
  projectId: string,
  layout: unknown,
): Promise<void> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const { data: students } = await supabase
    .from("students")
    .select("id")
    .eq("project_id", projectId);
  const studentIds = (students ?? []).map((s) => s.id);

  const normalized = normalizeLayout(layout, studentIds);

  const { error } = await supabase.from("ui_layouts").upsert(
    {
      user_id: userId,
      project_id: projectId,
      layout: normalized,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,project_id" },
  );
  if (error) throw new Error(`레이아웃 저장 실패: ${error.message}`);
}
