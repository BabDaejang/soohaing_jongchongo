import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database, Profile } from "@/lib/supabase/types";

// 접근 제어 (SPEC 2절 — 미들웨어에서 강제. Next.js 16 규약에 따라 파일명은 proxy.ts):
//   비로그인            → /login
//   pending·rejected    → /waiting 만 허용
//   approved(user)      → 앱 전체, 단 /admin 불가
//   approved(admin)     → 전체
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다.",
    );
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // 주의: 클라이언트 생성과 getUser() 사이에 다른 로직을 넣지 않는다 (세션 갱신 쿠키 유실 방지).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Cron 라우트는 자체 시크릿(CRON_SECRET)으로 인증하므로 세션 가드를 통과시킨다(세션 6).
  if (pathname.startsWith("/api/cron")) {
    return supabaseResponse;
  }

  // 갱신된 세션 쿠키를 유지한 채 리디렉션
  const redirectTo = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url));
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  if (!user) {
    if (pathname === "/login" || pathname.startsWith("/auth")) {
      return supabaseResponse;
    }
    return redirectTo("/login");
  }

  // OAuth 콜백·로그아웃은 승인 상태와 무관하게 통과
  if (pathname.startsWith("/auth")) {
    return supabaseResponse;
  }

  const { data } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();
  const profile: Pick<Profile, "role" | "status"> | null = data;

  if (profile?.status !== "approved") {
    // pending·rejected는 물론, 프로필 행이 없는 예외 상황도 보수적으로 대기 화면만 허용.
    // 이 게이트가 /projects/* 를 포함한 모든 앱 라우트를 approved 전용으로 강제한다(세션 4).
    // 프로젝트 소유권은 라우트 수준이 아니라 RLS(owns_project)·서버 액션·페이지 조회에서 강제한다.
    return pathname === "/waiting" ? supabaseResponse : redirectTo("/waiting");
  }

  if (pathname === "/login" || pathname === "/waiting") {
    return redirectTo("/");
  }

  if (pathname.startsWith("/admin") && profile.role !== "admin") {
    return redirectTo("/");
  }

  return supabaseResponse;
}

export const config = {
  // 정적 자산·이미지 제외 전 경로에 적용
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
