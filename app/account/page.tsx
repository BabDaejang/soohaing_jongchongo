import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { PersonalKeys } from "@/components/account/personal-keys";
import type { KeyStatus, Provider } from "@/lib/supabase/types";

// 계정 옵션 — 개인 API 키 관리 (SPEC 3절). 승인된 사용자면 접근 가능(proxy.ts).
export default async function AccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [providersRes, keysRes] = await Promise.all([
    supabase.from("providers").select("*").order("name"),
    // 본인 개인 키의 마스킹 정보와 모델 목록만 (RLS로 본인 행만 반환). encrypted_key는 select 안 함.
    user
      ? supabase
          .from("api_keys")
          .select("provider_id, key_last4, models, models_synced_at")
          .eq("owner_id", user.id)
      : Promise.resolve({
          data: [] as {
            provider_id: string;
            key_last4: string;
            models: string[];
            models_synced_at: string | null;
          }[],
        }),
  ]);

  const providers: Provider[] = providersRes.data ?? [];
  const personalKeys: Record<string, KeyStatus> = {};
  for (const row of keysRes.data ?? []) {
    personalKeys[row.provider_id] = {
      last4: row.key_last4,
      models: row.models ?? [],
      syncedAt: row.models_synced_at,
    };
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">계정 옵션</h1>
          <p className="mt-1 text-sm text-zinc-500">
            개인 API 키를 등록하면 관리자 기본 키 대신 사용됩니다.
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/"
            className="text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            홈
          </Link>
          <SignOutButton />
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-semibold">개인 API 키</h2>
        <PersonalKeys providers={providers} personalKeys={personalKeys} />
      </section>
    </main>
  );
}
