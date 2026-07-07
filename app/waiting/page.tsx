import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

const FALLBACK_MESSAGE =
  "가입 신청이 접수되었습니다. 관리자 승인 후 이용할 수 있습니다.";

// 미승인(pending·rejected) 사용자 대기 화면 (SPEC 2절).
// 접근 제어는 proxy.ts가 강제한다 — 승인 사용자는 /로 리디렉션된다.
export default async function WaitingPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "waiting_message")
    .maybeSingle();

  const message =
    typeof data?.value === "string" && data.value.trim() !== ""
      ? data.value
      : FALLBACK_MESSAGE;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold">승인 대기 중</h1>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          {message}
        </p>
      </div>
      <SignOutButton />
    </main>
  );
}
