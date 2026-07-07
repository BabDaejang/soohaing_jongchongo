import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Google OAuth 콜백. code를 세션으로 교환한 뒤 홈으로 보낸다.
// 이후 라우팅(승인 상태별 분기)은 proxy.ts가 처리한다.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await promoteInitialAdmin(data.user);
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}

// 최초 관리자 지정: ADMIN_EMAIL 환경변수와 일치하는 계정을 admin·approved로 승격한다.
// 멱등 — 이미 admin이면 아무것도 하지 않는다. 다른 계정에는 어떤 영향도 없다.
async function promoteInitialAdmin(user: User) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !user.email) return;
  if (user.email.toLowerCase() !== adminEmail.toLowerCase()) return;

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ role: "admin", status: "approved" })
    .eq("id", user.id)
    .neq("role", "admin");

  if (error) {
    // 승격 실패가 로그인 자체를 막아서는 안 된다. 키·평문 없이 메시지만 남긴다.
    console.error("최초 관리자 승격 실패:", error.message);
  }
}
