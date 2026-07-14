// 파싱 공용 타입 (세션 5). SPEC 1·5절.
import type { SubmissionSourceType } from "@/lib/supabase/types";

// submissions.source_type와 동일 집합(드리프트 방지 위해 재사용).
export type SourceType = SubmissionSourceType;

// 스프레드시트(xlsx/csv) 파싱 결과: 첫 행을 헤더로, 나머지를 데이터 행으로.
export type SpreadsheetData = {
  headers: string[];
  rows: string[][];
};

// 열 매핑 UI에서 교사가 확정하는 열 인덱스(없으면 null).
export type ColumnMapping = {
  studentNo: number | null;
  studentName: number | null;
  submissionId: number | null;
  content: Array<{ index: number; label: string }>;
};
