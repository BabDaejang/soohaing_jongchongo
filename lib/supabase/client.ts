import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// 브라우저(클라이언트 컴포넌트)용 Supabase 클라이언트. anon key만 사용한다.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다.",
    );
  }
  return createBrowserClient<Database>(url, anonKey);
}
