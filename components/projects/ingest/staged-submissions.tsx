import type { MatchStatus, SubmissionSourceType } from "@/lib/supabase/types";

type StagedRow = {
  id: string;
  source_filename: string | null;
  source_type: SubmissionSourceType;
  match_status: MatchStatus;
  content_text: string;
  raw_student_no: string | null;
  raw_student_name: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<SubmissionSourceType, string> = {
  xlsx: "엑셀",
  csv: "CSV",
  docx: "워드",
  pdf_text: "PDF(텍스트)",
  pdf_scan: "PDF(스캔·OCR)",
  image: "이미지(OCR)",
  manual: "수동",
};

const STATUS_LABEL: Record<MatchStatus, string> = {
  unmatched: "미매칭",
  auto_matched: "자동 매칭",
  pending_confirm: "확인 대기",
  confirmed: "확정",
  update_pending: "갱신 대기",
};

export function StagedSubmissions({
  submissions,
}: {
  submissions: StagedRow[];
}) {
  if (submissions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">
        아직 수합된 제출물이 없습니다. 위에서 파일을 업로드하세요.
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {submissions.map((s) => {
        const who =
          s.raw_student_no || s.raw_student_name
            ? [s.raw_student_no, s.raw_student_name].filter(Boolean).join(" · ")
            : null;
        return (
          <li
            key={s.id}
            className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-800">
                {TYPE_LABEL[s.source_type]}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 ${
                  s.match_status === "update_pending"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                }`}
              >
                {STATUS_LABEL[s.match_status]}
              </span>
              {who && <span className="text-zinc-500">{who}</span>}
              {s.source_filename && (
                <span className="text-zinc-400">{s.source_filename}</span>
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
              {s.content_text.slice(0, 200) || "(빈 내용)"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
