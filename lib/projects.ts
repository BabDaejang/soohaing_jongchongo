import "server-only";
import { requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// 프로젝트 소유 확인 (승인 + 본인 소유). RLS(owns_project)가 최종 방어선이지만,
// 서버 액션은 경로와 무관하게 호출될 수 있으므로 여기서도 소유권을 재확인한다(심층 방어,
// DECISIONS 2026-07-08). admin은 select 가능하지만 owner_id 비교로 소유자만 통과시킨다.
export async function requireProjectOwner(projectId: string): Promise<{
  userId: string;
  supabase: SupabaseClient<Database>;
}> {
  const { userId } = await requireApproved();
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!data || data.owner_id !== userId) {
    throw new Error("프로젝트를 찾을 수 없거나 접근 권한이 없습니다.");
  }
  return { userId, supabase };
}
