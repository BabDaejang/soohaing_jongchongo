import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303: POST 후 GET으로 리디렉션
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
