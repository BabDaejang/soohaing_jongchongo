import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeExpiredOriginals } from "@/lib/originals";

// 원본 자동 삭제(N일) Cron 엔드포인트 (SPEC 5.3 보조 정책, 세션 6).
// 스케줄러(Vercel Cron / Supabase pg_cron 등)가 `Authorization: Bearer $CRON_SECRET`로 호출한다.
// INV-5: purgeExpiredOriginals는 추출 승인·경과된 원본만 삭제(isPurgeEligible).
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET 미설정" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const result = await purgeExpiredOriginals(admin);
  return NextResponse.json(result);
}

// Vercel Cron은 GET, 외부 스케줄러는 POST를 보낼 수 있어 둘 다 지원(모두 시크릿 필요).
export const GET = handle;
export const POST = handle;
