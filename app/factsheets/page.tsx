import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasAladinKey } from "@/lib/factsheet/aladin";
import { hasNaverKeys } from "@/lib/factsheet/naver";
import { BookSearch } from "@/components/factsheets/book-search";
import { FactsheetsExportButton } from "@/components/factsheets/factsheets-export-button";
import type { ShareStatus } from "@/lib/supabase/types";

// 도서팩트시트 전용 페이지 (리팩토링 2 배치 8) — 계정 단위(프로젝트 무관).
// 내 팩트시트 + 공유(shared) 목록 · 도서 검색 모듈 · 검색 키 미설정 배너.
// 접근 게이트는 proxy.ts가 승인 사용자 전역으로 강제한다(추가 라우트 규칙 불필요).

const SHARE_LABEL: Record<ShareStatus, string> = {
  private: "비공개",
  pending_review: "승인 대기",
  shared: "공유됨",
  rejected: "반려",
};

type Row = {
  id: string;
  isbn13: string | null;
  title: string;
  author: string | null;
  share_status: ShareStatus;
  updated_at: string | null;
  created_at: string;
};

function dateOf(r: Row): string {
  return (r.updated_at ?? r.created_at).slice(0, 10);
}

export default async function FactsheetsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const cols = "id, isbn13, title, author, share_status, updated_at, created_at";
  const [mineRes, sharedRes] = await Promise.all([
    user
      ? supabase
          .from("factsheets")
          .select(cols)
          .eq("owner_id", user.id)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[] }),
    user
      ? supabase
          .from("factsheets")
          .select(cols)
          .eq("share_status", "shared")
          .neq("owner_id", user.id)
          .order("updated_at", { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  const mine: Row[] = mineRes.data ?? [];
  const shared: Row[] = sharedRes.data ?? [];

  // entry 수를 한 번에 집계(RLS can_read가 내 것·shared를 허용).
  const ids = [...mine, ...shared].map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: entryRows } = await supabase
      .from("factsheet_entries")
      .select("factsheet_id")
      .in("factsheet_id", ids);
    for (const e of entryRows ?? []) {
      counts.set(e.factsheet_id, (counts.get(e.factsheet_id) ?? 0) + 1);
    }
  }

  const aladinReady = hasAladinKey();
  const naverReady = hasNaverKeys();
  const keysMissing = !aladinReady || !naverReady;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">도서팩트시트</h1>
          <p className="mt-1 text-sm text-zinc-500">
            독서 활동 제출물의 진실성 검증에 쓰는 도서별 사실 모음(메타·목차·챕터 내용).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FactsheetsExportButton />
          <Link
            href="/"
            className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            홈
          </Link>
        </div>
      </header>

      {keysMissing && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
          관리자가 검색 API 키를 등록해야 도서 검색·자동 수집이 동작합니다(수동 입력·촬영본 보강은
          가능). 미설정: {!aladinReady && "알라딘"}
          {!aladinReady && !naverReady && " · "}
          {!naverReady && "네이버"}.
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">도서 검색</h2>
        <BookSearch aladinReady={aladinReady} />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">내 팩트시트 ({mine.length})</h2>
        {mine.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
            아직 만든 팩트시트가 없습니다. 위에서 책을 검색해 만들어 보세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mine.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/factsheets/${r.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {[r.author, r.isbn13 ? `ISBN ${r.isbn13}` : null, `항목 ${counts.get(r.id) ?? 0}`, dateOf(r)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="ml-3 flex-shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {SHARE_LABEL[r.share_status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">공유 팩트시트 ({shared.length})</h2>
        {shared.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
            공유된 팩트시트가 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shared.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/factsheets/${r.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {[r.author, r.isbn13 ? `ISBN ${r.isbn13}` : null, `항목 ${counts.get(r.id) ?? 0}`, dateOf(r)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="ml-3 flex-shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                    공유
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
