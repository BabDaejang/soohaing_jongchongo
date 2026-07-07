import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// service role 클라이언트 — RLS를 우회하므로 서버 전용(INV-4)이며 용도를 명시적으로 한정한다.
// 세션 1 용도: 최초 관리자(ADMIN_EMAIL) 승격뿐.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
