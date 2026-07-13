import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listRoutableProviders } from "@/lib/llm/available";
import { FactsheetDetail } from "@/components/factsheets/factsheet-detail";
import type { Factsheet, FactsheetEntry } from "@/lib/supabase/types";

// 도서팩트시트 상세 (리팩토링 2 배치 8). 메타·챕터별 entry 편집(소유·비shared),
// 촬영본 OCR 보강, 공유 신청, shared 읽기 전용 + 내 계정으로 복제.
export const maxDuration = 120; // 촬영본 OCR(callLLM) 여유

export default async function FactsheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const [fsRes, entriesRes] = await Promise.all([
    supabase.from("factsheets").select("*").eq("id", id).maybeSingle(), // RLS: 소유/shared/admin
    supabase
      .from("factsheet_entries")
      .select("*")
      .eq("factsheet_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const factsheet = fsRes.data as Factsheet | null;
  if (!factsheet) notFound();
  const entries = (entriesRes.data ?? []) as FactsheetEntry[];

  const isOwner = factsheet.owner_id === user.id;
  const isShared = factsheet.share_status === "shared";
  const editable = isOwner && !isShared; // shared는 소유자도 읽기 전용(RLS와 정합)
  const showFork = isShared && !isOwner;

  // OCR 보강 모델 선택은 편집 가능할 때만 필요.
  const providers = editable ? await listRoutableProviders(user.id) : [];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <header className="mb-6">
        <Link
          href="/factsheets"
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 도서팩트시트 목록
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{factsheet.title}</h1>
      </header>

      <FactsheetDetail
        factsheet={factsheet}
        entries={entries}
        editable={editable}
        isOwner={isOwner}
        isShared={isShared}
        showFork={showFork}
        providers={providers}
      />
    </main>
  );
}
