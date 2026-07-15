"use client";

import { useState, useEffect, useTransition } from "react";
import {
  getAvailableFactsheets,
  linkBookToStudentSubmissions,
  unlinkBookFromStudentSubmissions,
  linkBookToSubmission,
  unlinkBookFromSubmission,
} from "@/app/projects/[id]/evaluate/actions";
import { searchBooksAction, createFactsheetFromBook } from "@/app/factsheets/actions";
import type { BookCandidate } from "@/lib/factsheet/aladin";

interface BookSelectModalProps {
  projectId: string;
  studentId?: string;
  submissionId?: string;
  studentName: string;
  selectedBooks: { factsheetId: string; title: string }[];
  onClose: () => void;
  onRefresh: () => void;
}

export function BookSelectModal({
  projectId,
  studentId,
  submissionId,
  studentName,
  selectedBooks,
  onClose,
  onRefresh,
}: BookSelectModalProps) {
  const [availableFactsheets, setAvailableFactsheets] = useState<{ id: string; title: string; author: string | null }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BookCandidate[] | null>(null);
  const [searching, startSearch] = useTransition();
  const [linking, startLink] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAvailableFactsheets()
      .then(setAvailableFactsheets)
      .catch((err) => setError(err instanceof Error ? err.message : "팩트시트 로드 실패"));
  }, []);

  const handleLink = (factsheetId: string) => {
    setError(null);
    startLink(async () => {
      try {
        if (studentId) {
          await linkBookToStudentSubmissions(projectId, studentId, factsheetId);
        } else if (submissionId) {
          await linkBookToSubmission(projectId, submissionId, factsheetId);
        }
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "도서 연결 실패");
      }
    });
  };

  const handleUnlink = (factsheetId: string) => {
    setError(null);
    startLink(async () => {
      try {
        if (studentId) {
          await unlinkBookFromStudentSubmissions(projectId, studentId, factsheetId);
        } else if (submissionId) {
          await unlinkBookFromSubmission(projectId, submissionId, factsheetId);
        }
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "도서 연결 해제 실패");
      }
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setError(null);
    startSearch(async () => {
      const res = await searchBooksAction(searchQuery);
      if (!res.ok) {
        setError(res.error ?? "검색에 실패했습니다.");
        setSearchResults([]);
        return;
      }
      setSearchResults(res.results);
    });
  };

  const handleCreateAndLink = (isbn13: string) => {
    setError(null);
    startLink(async () => {
      try {
        const { id: factsheetId } = await createFactsheetFromBook(isbn13);
        if (studentId) {
          await linkBookToStudentSubmissions(projectId, studentId, factsheetId);
        } else if (submissionId) {
          await linkBookToSubmission(projectId, submissionId, factsheetId);
        }
        onRefresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "도서 생성 및 연결 실패");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border-2 border-zinc-900 bg-white p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:border-zinc-100 dark:bg-zinc-950 dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]">
        <header className="mb-4 flex items-center justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            {studentName} 도서 연결 설정
          </h2>
          <button
            onClick={onClose}
            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            닫기
          </button>
        </header>

        {error && (
          <p className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </p>
        )}

        {/* 현재 연결된 도서 목록 */}
        <section className="mb-5">
          <h3 className="mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            현재 연결된 도서
          </h3>
          {selectedBooks.length === 0 ? (
            <p className="text-sm text-zinc-400">연결된 도서가 없습니다. (출처 식별 불가)</p>
          ) : (
            <ul className="space-y-1.5 font-sans">
              {selectedBooks.map((b) => (
                <li
                  key={b.factsheetId}
                  className="flex items-center justify-between rounded border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate pr-2">
                    {b.title}
                  </span>
                  <button
                    onClick={() => handleUnlink(b.factsheetId)}
                    disabled={linking}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    연결 해제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 기존 팩트시트에서 선택 */}
        <section className="mb-5">
          <h3 className="mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            수집된 도서에서 연결
          </h3>
          <div className="flex gap-2 font-sans">
            <select
              onChange={(e) => e.target.value && handleLink(e.target.value)}
              disabled={linking}
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              defaultValue=""
            >
              <option value="" disabled>
                도서 선택...
              </option>
              {availableFactsheets
                .filter((fs) => !selectedBooks.some((b) => b.factsheetId === fs.id))
                .map((fs) => (
                  <option key={fs.id} value={fs.id}>
                    {fs.title} {fs.author ? `(${fs.author})` : ""}
                  </option>
                ))}
            </select>
          </div>
        </section>

        {/* 알라딘 도서 검색 및 생성 */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            새로운 도서 검색 및 추가
          </h3>
          <form onSubmit={handleSearch} className="mb-3 flex gap-2 font-sans">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="책 제목 또는 저자로 검색"
              className="flex-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              type="submit"
              disabled={searching || !searchQuery.trim()}
              className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              {searching ? "검색 중..." : "검색"}
            </button>
          </form>

          {searchResults && searchResults.length > 0 && (
            <ul className="max-h-40 overflow-y-auto divide-y divide-zinc-100 border border-zinc-200 rounded dark:divide-zinc-800 dark:border-zinc-800 font-sans">
              {searchResults.map((b) => (
                <li
                  key={b.isbn13}
                  className="flex items-center justify-between p-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="font-semibold truncate">{b.title}</p>
                    <p className="text-zinc-500 truncate">{b.author}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => b.isbn13 && handleCreateAndLink(b.isbn13)}
                    disabled={linking || !b.isbn13}
                    className="flex-shrink-0 rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    추가 및 연결
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchResults && searchResults.length === 0 && (
            <p className="text-xs text-zinc-400">검색 결과가 없습니다.</p>
          )}
        </section>
      </div>
    </div>
  );
}
