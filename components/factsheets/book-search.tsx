"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchBooksAction, createFactsheetFromBook } from "@/app/factsheets/actions";
import type { BookCandidate } from "@/lib/factsheet/aladin";

// 도서 검색 모듈 (리팩토링 2 배치 8). 알라딘 검색 → 후보 카드 → [팩트시트 만들기].
// 생성은 메타·목차·소개만 저장(entry 자동 수집은 배치 9). 검색 키 미설정이면 비활성.
export function BookSearch({ aladinReady }: { aladinReady: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [creatingIsbn, setCreatingIsbn] = useState<string | null>(null);
  const [, startCreate] = useTransition();

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || !aladinReady) return;
    setError(null);
    startSearch(async () => {
      const res = await searchBooksAction(query);
      if (!res.ok) {
        setError(res.error ?? "검색에 실패했습니다.");
        setResults([]);
        return;
      }
      setResults(res.results);
    });
  }

  function onCreate(isbn13: string) {
    setError(null);
    setCreatingIsbn(isbn13);
    startCreate(async () => {
      try {
        const { id } = await createFactsheetFromBook(isbn13);
        router.push(`/factsheets/${id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "팩트시트 생성에 실패했습니다.");
        setCreatingIsbn(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={aladinReady ? "책 제목·저자로 검색" : "검색 키 미설정 — 검색 비활성"}
          disabled={!aladinReady}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={searching || !query.trim() || !aladinReady}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {searching ? "검색 중…" : "검색"}
        </button>
      </form>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {results && results.length === 0 && !error && (
        <p className="text-sm text-zinc-500">검색 결과가 없습니다.</p>
      )}

      {results && results.length > 0 && (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {results.map((b, i) => (
            <li key={`${b.isbn13 ?? b.title}-${i}`} className="flex items-start gap-3 py-3">
              {b.coverUrl ? (
                // 외부(알라딘) 표지 URL — next/image remotePatterns 대신 <img> 사용.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.coverUrl}
                  alt=""
                  className="h-16 w-12 flex-shrink-0 rounded object-cover"
                />
              ) : (
                <div className="h-16 w-12 flex-shrink-0 rounded bg-zinc-100 dark:bg-zinc-800" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{b.title}</p>
                <p className="truncate text-xs text-zinc-500">
                  {[b.author, b.publisher, b.pubYear].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {b.isbn13 ? `ISBN ${b.isbn13}` : "ISBN 없음 — 팩트시트 생성 불가"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => b.isbn13 && onCreate(b.isbn13)}
                disabled={!b.isbn13 || creatingIsbn !== null}
                className="flex-shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {creatingIsbn === b.isbn13 ? "생성 중…" : "팩트시트 만들기"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
