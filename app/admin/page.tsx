import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { AccountList } from "@/components/admin/account-list";
import { WaitingMessageEditor } from "@/components/admin/waiting-message-editor";
import { ProviderManager } from "@/components/admin/provider-manager";
import type { KeyStatus, Profile, Provider } from "@/lib/supabase/types";

// 관리자 패널 (SPEC 2·3절). 접근 제어는 proxy.ts가 강제한다(admin만).
export default async function AdminPage() {
  const supabase = await createClient();

  const [profilesRes, settingRes, providersRes, keysRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, name, role, status, created_at, updated_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "waiting_message")
      .maybeSingle(),
    supabase.from("providers").select("*").order("name"),
    // 기본 키(owner_id NULL)의 마스킹 정보와 모델 목록만 — encrypted_key는 절대 select 하지 않는다.
    supabase
      .from("api_keys")
      .select("provider_id, key_last4, models, models_synced_at")
      .is("owner_id", null),
  ]);

  const profiles: Profile[] = profilesRes.data ?? [];
  const providers: Provider[] = providersRes.data ?? [];
  const waitingMessage =
    typeof settingRes.data?.value === "string" ? settingRes.data.value : "";
  const defaultKeys: Record<string, KeyStatus> = {};
  for (const row of keysRes.data ?? []) {
    defaultKeys[row.provider_id] = {
      last4: row.key_last4,
      models: row.models ?? [],
      syncedAt: row.models_synced_at,
    };
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">관리자 패널</h1>
          <p className="mt-1 text-sm text-zinc-500">
            계정 승인 · 대기 화면 안내문 · API 키 체계
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200">
            홈
          </Link>
          <SignOutButton />
        </div>
      </header>

      <div className="flex flex-col gap-10">
        <section>
          <h2 className="mb-3 text-lg font-semibold">계정 관리</h2>
          <AccountList profiles={profiles} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">대기 화면 안내문</h2>
          <WaitingMessageEditor message={waitingMessage} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">프로바이더 · 기본 API 키</h2>
          <ProviderManager providers={providers} defaultKeys={defaultKeys} />
        </section>
      </div>
    </main>
  );
}
