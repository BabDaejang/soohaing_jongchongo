import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listRoutableProviders } from "@/lib/llm/available";
import { SignOutButton } from "@/components/sign-out-button";
import { AccountList } from "@/components/admin/account-list";
import { WaitingMessageEditor } from "@/components/admin/waiting-message-editor";
import { ProviderManager } from "@/components/admin/provider-manager";
import {
  FactsheetReview,
  type PendingItem,
  type ReviewEntryInfo,
  type ReviewReport,
  type SharedItem,
} from "@/components/admin/factsheet-review";
import type {
  FactsheetSourceType,
  KeyStatus,
  Profile,
  Provider,
} from "@/lib/supabase/types";

// 관리자 패널 (SPEC 2·3절). 접근 제어는 proxy.ts가 강제한다(admin만).

// 저장된 review jsonb(unknown)를 화면용 ReviewReport로 방어적으로 해석한다.
function parseReview(raw: unknown): ReviewReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const report: ReviewReport = {};
  const s = rec.summary;
  if (s && typeof s === "object" && !Array.isArray(s)) {
    const sr = s as Record<string, unknown>;
    report.summary = {
      pass: typeof sr.pass === "number" ? sr.pass : 0,
      fail: typeof sr.fail === "number" ? sr.fail : 0,
      unfetchable: typeof sr.unfetchable === "number" ? sr.unfetchable : 0,
    };
  }
  const m = rec.metaCheck;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const mr = m as Record<string, unknown>;
    report.metaCheck = {
      status: typeof mr.status === "string" ? mr.status : "",
      note: typeof mr.note === "string" ? mr.note : "",
    };
  }
  if (typeof rec.model === "string") report.model = rec.model;
  if (typeof rec.reviewed_at === "string") report.reviewed_at = rec.reviewed_at;
  if (typeof rec.rejected_reason === "string") report.rejected_reason = rec.rejected_reason;
  return report;
}

type FactsheetRow = {
  id: string;
  owner_id: string;
  title: string;
  author: string | null;
  isbn13: string | null;
  created_at: string;
  reviewed_at: string | null;
  review: unknown;
};

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profilesRes, settingRes, providersRes, keysRes, pendingRes, sharedRes] =
    await Promise.all([
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
      // 승인 대기 큐(오래된 신청 먼저).
      supabase
        .from("factsheets")
        .select("id, owner_id, title, author, isbn13, created_at, reviewed_at, review")
        .eq("share_status", "pending_review")
        .order("created_at", { ascending: true }),
      // 공유됨(최근 승인 먼저).
      supabase
        .from("factsheets")
        .select("id, owner_id, title, author, isbn13, created_at, reviewed_at, review")
        .eq("share_status", "shared")
        .order("reviewed_at", { ascending: false, nullsFirst: false }),
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

  const pendingRows: FactsheetRow[] = pendingRes.data ?? [];
  const sharedRows: FactsheetRow[] = sharedRes.data ?? [];
  const allFactsheetIds = [...pendingRows, ...sharedRows].map((r) => r.id);

  // 소유 교사 이메일 매핑.
  const ownerIds = Array.from(
    new Set([...pendingRows, ...sharedRows].map((r) => r.owner_id)),
  );
  const emailById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", ownerIds);
    for (const o of owners ?? []) emailById.set(o.id, o.email);
  }

  // 승인 대기분은 항목 전문(열람용), 공유분은 개수만.
  const entriesByFactsheet = new Map<string, ReviewEntryInfo[]>();
  const entryCount = new Map<string, number>();
  if (allFactsheetIds.length > 0) {
    const { data: entryRows } = await supabase
      .from("factsheet_entries")
      .select("id, factsheet_id, chapter_label, content, quote, source_url, source_type")
      .in("factsheet_id", allFactsheetIds)
      .order("created_at", { ascending: true });
    for (const e of entryRows ?? []) {
      entryCount.set(e.factsheet_id, (entryCount.get(e.factsheet_id) ?? 0) + 1);
      const list = entriesByFactsheet.get(e.factsheet_id) ?? [];
      list.push({
        id: e.id,
        chapterLabel: e.chapter_label,
        content: e.content,
        quote: e.quote,
        sourceUrl: e.source_url,
        sourceType: e.source_type as FactsheetSourceType,
      });
      entriesByFactsheet.set(e.factsheet_id, list);
    }
  }

  const pending: PendingItem[] = pendingRows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    isbn13: r.isbn13,
    createdAt: r.created_at,
    ownerEmail: emailById.get(r.owner_id) ?? "(알 수 없음)",
    review: parseReview(r.review),
    entries: entriesByFactsheet.get(r.id) ?? [],
  }));

  const shared: SharedItem[] = sharedRows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    ownerEmail: emailById.get(r.owner_id) ?? "(알 수 없음)",
    reviewedAt: r.reviewed_at,
    entryCount: entryCount.get(r.id) ?? 0,
    review: parseReview(r.review),
  }));

  const routableProviders = user ? await listRoutableProviders(user.id) : [];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">관리자 패널</h1>
          <p className="mt-1 text-sm text-zinc-500">
            계정 승인 · 대기 화면 안내문 · API 키 체계 · 팩트시트 공유 승인
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

        <section>
          <h2 className="mb-1 text-lg font-semibold">도서팩트시트 공유 승인</h2>
          <p className="mb-3 text-sm text-zinc-500">
            교사가 전체 공유를 신청한 팩트시트를 AI가 엄격하게 자동 검증(출처 재수집·발췌 실존
            대조·내용 뒷받침 판정)한 리포트를 참고해 승인/반려합니다. 판정은 참고 자료이며 최종
            결정은 관리자가 합니다. 승인 시 전 계정이 읽기 전용으로 재사용합니다.
          </p>
          <FactsheetReview
            pending={pending}
            shared={shared}
            providers={routableProviders}
          />
        </section>
      </div>
    </main>
  );
}
