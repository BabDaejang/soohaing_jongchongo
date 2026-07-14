// 작업결과표(대시보드 하단, SPEC 8절 후속) 공유 타입 — 리팩토링 2 배치 3.
// 8열 계약(순서 고정, 배치 간 불변). 열 키·라벨은 공통 프롬프트의 공유 계약과 일치해야 한다.

import type { AuthenticityStatus } from "@/lib/supabase/types";

export const WORKSHEET_COLUMNS = [
  "internal_id",
  "student_number",
  "name",
  "submission_count",
  "score",
  "grade",
  "record",
  "memo",
] as const;

export type WorksheetColumnKey = (typeof WORKSHEET_COLUMNS)[number];

export const COLUMN_LABELS: Record<WorksheetColumnKey, string> = {
  internal_id: "ID",
  student_number: "학번",
  name: "이름",
  submission_count: "업로드 된 제출물 갯수",
  score: "반영 점수",
  grade: "등급",
  record: "생성된 생기부",
  memo: "교사 관찰 메모창",
};

// 제출물 펼침 서브행 배지용 진실성 상태 추가(배치 10). 8열 계약은 불변 — 행 타입 확장은
// 계약 위반이 아니다(열 키가 그대로면 됨).
export type WorksheetSubmission = {
  id: string;
  title: string;
  authenticityStatus: AuthenticityStatus;
  contentText: string;
};

export type WorksheetRow = {
  studentId: string; // = students.id (제품 부여 고유 번호). 셀에는 앞 8자 + title 속성으로 전문
  studentNumber: string | null;
  name: string;
  submissionCount: number;
  submissions: WorksheetSubmission[]; // title = source_filename ?? submission_key ?? id 앞 8자
  displayScore: number | null; // override ?? student_scores.display_score ?? null
  hasOverride: boolean;
  overrideReason: string | null;
  grade: number | null; // student_scores.grade 스냅샷(INV-6 파생 저장값)
  recordContent: string | null; // 현재(is_current) 생기부 본문
  recordVersion: number | null;
  memo: string; // students.teacher_memo ?? ""
};
