"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { exportAllFactsheetsAction } from "@/app/factsheets/actions";
import { formatDownloadStamp } from "@/lib/worksheet/download";

const SHARE_LABEL: Record<string, string> = {
  private: "비공개",
  pending_review: "승인 대기",
  shared: "공유됨",
  rejected: "반려",
};

const SOURCE_LABEL: Record<string, string> = {
  aladin: "알라딘",
  naver_book: "네이버 책",
  naver_blog: "네이버 블로그",
  naver_news: "네이버 뉴스",
  web: "웹",
  user_upload: "촬영본",
  user_manual: "직접 입력",
};

export function FactsheetsExportButton() {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (loading) return;
    setLoading(true);
    try {
      const data = await exportAllFactsheetsAction();
      if (!data.factsheets || data.factsheets.length === 0) {
        alert("다운로드할 팩트시트가 없습니다.");
        setLoading(false);
        return;
      }

      // 1. 도서 목록 Sheet AoA 생성
      const fsHeader = ["도서명", "저자", "출판사", "출간연도", "ISBN13", "공유 상태", "등록일"];
      const fsBody = data.factsheets.map((f) => {
        return [
          f.title,
          f.author ?? "",
          f.publisher ?? "",
          f.pub_year ?? "",
          f.isbn13 ?? "",
          SHARE_LABEL[f.share_status] ?? f.share_status,
          f.created_at.slice(0, 10),
        ];
      });
      const fsAoA = [fsHeader, ...fsBody];

      // 2. 전체 사실 항목 Sheet AoA 생성
      const entriesHeader = [
        "도서명",
        "저자",
        "ISBN13",
        "챕터/위치",
        "사실 서술 내용",
        "원문 발췌",
        "출처 구분",
        "출처 URL",
        "등록일",
      ];
      const fsMap = new Map(data.factsheets.map((f) => [f.id, f]));
      const entriesBody = data.entries.map((e) => {
        const fs = fsMap.get(e.factsheet_id);
        return [
          fs ? fs.title : "",
          fs ? fs.author ?? "" : "",
          fs ? fs.isbn13 ?? "" : "",
          e.chapter_label,
          e.content,
          e.quote ?? "",
          SOURCE_LABEL[e.source_type] ?? e.source_type,
          e.source_url ?? "",
          e.created_at.slice(0, 10),
        ];
      });
      const entriesAoA = [entriesHeader, ...entriesBody];

      // 3. XLSX 파일 생성 및 저장
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const wsFs = XLSX.utils.aoa_to_sheet(fsAoA);
      XLSX.utils.book_append_sheet(wb, wsFs, "도서 목록");

      const wsEntries = XLSX.utils.aoa_to_sheet(entriesAoA);
      XLSX.utils.book_append_sheet(wb, wsEntries, "전체 사실 항목");

      const stamp = formatDownloadStamp(new Date());
      XLSX.writeFile(wb, `도서팩트시트_전체_${stamp}.xlsx`);
    } catch (err) {
      console.error(err);
      alert("엑셀 다운로드 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      <Download className="h-4 w-4" />
      {loading ? "다운로드 중..." : "엑셀 다운로드"}
    </button>
  );
}
