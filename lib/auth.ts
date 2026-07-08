import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRole, ProfileStatus } from "@/lib/supabase/types";

// 세션 사용자와 프로필(role·status)을 함께 조회한다. 서버 액션·페이지의 권한 확인용.
export type AuthContext = {
  userId: string;
  role: ProfileRole;
  status: ProfileStatus;
};

async function getContext(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;

  return { userId: user.id, role: data.role, status: data.status };
}

// 관리자 전용 서버 액션 진입점. proxy.ts가 이미 /admin을 막지만, 액션은 경로와 무관하게
// 호출될 수 있으므로 여기서 한 번 더 강제한다(심층 방어). RLS가 최종 방어선이다.
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx || ctx.role !== "admin") {
    throw new Error("관리자 권한이 필요합니다.");
  }
  return ctx;
}

// 승인된 사용자 전용(개인 키 등록 등).
export async function requireApproved(): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx || ctx.status !== "approved") {
    throw new Error("승인된 사용자만 접근할 수 있습니다.");
  }
  return ctx;
}
