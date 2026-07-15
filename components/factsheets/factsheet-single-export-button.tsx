"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { FactsheetEntry } from "@/lib/supabase/types";
import { formatDownloadStamp, sanitizeFilename } from "@/lib/worksheet/download";

const SOURCE_LABEL: Record<string, string> = {
  aladin: "알라딘",
  naver_book: "네이버 책",
  naver_blog: "네이버 블로그",
  naver_news: "네이버 뉴스",
  web: "웹",
  user_upload: "촬영본",
  user_manual: "직접 입력",
};

interface FactsheetSingleExportButtonProps {
  factsheetTitle: string;
  entries: FactsheetEntry[];
}

export function FactsheetSingleExportButton({
  factsheetTitle,
  entries,
}: FactsheetSingleExportButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (loading) return;
    setLoading(true);
    try {
      // 1. 단일 도서 사실 항목 AoA 생성
      const header = ["챕터/위치", "사실 서술 내용", "원문 발췌", "출처 구분", "출처 URL", "등록일"];
      const body = entries.map((e) => [
        e.chapter_label,
        e.content,
        e.quote ?? "",
        SOURCE_LABEL[e.source_type] ?? e.source_type,
        e.source_url ?? "",
        e.created_at.slice(0, 10),
      ]);
      const aoa = [header, ...body];

      // 2. SheetJS 로드 및 생성
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();

      // Excel 시트명 글자 제한(최대 31자)을 위해 slice 처리
      const sheetName = sanitizeFilename(factsheetTitle).slice(0, 30) || "팩트시트";
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      const stamp = formatDownloadStamp(new Date());
      const fileName = `${sanitizeFilename(factsheetTitle)}_팩트시트_${stamp}.xlsx`;

      XLSX.writeFile(wb, fileName);
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
      className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 bg-white hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-400 dark:bg-zinc-900 dark:hover:bg-zinc-800"
    >
      <Download className="h-3.5 w-3.5" />
      {loading ? "다운로드 중..." : "엑셀 다운로드"}
    </button>
  );
}
