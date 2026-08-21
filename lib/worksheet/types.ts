// 작업결과표(대시보드 하단, SPEC 8절 후속) 공유 타입 — 리팩토링 2 배치 3.
// 8열 계약(순서 고정, 배치 간 불변). 열 키·라벨은 공통 프롬프트의 공유 계약과 일치해야 한다.

import type {
  AuthenticityStatus,
  EvaluationOrigin,
  IdentitySource,
  MatchMethod,
} from "@/lib/supabase/types";

export const WORKSHEET_COLUMNS = [
  "internal_id",
  "student_number",
  "name",
  "selected_book",
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
  selected_book: "선택 도서",
  submission_count: "업로드 된 제출물 갯수",
  score: "반영 점수",
  grade: "등급",
  record: "생성된 생기부",
  memo: "교사 관찰 메모창",
};

// 제출물 펼침 서브행 배지용 진실성 상태 추가(배치 10) + 귀속 경로·식별값 출처 추가
// (리팩토링 4 배치 3 — 작업결과표에서 매칭을 확인·수정하기 위한 재료).
// 8열 계약은 불변 — 행 타입 확장은 계약 위반이 아니다(열 키가 그대로면 됨).
export type WorksheetSubmission = {
  id: string;
  title: string;
  authenticityStatus: AuthenticityStatus;
  contentText: string;
  factsheetId: string | null;
  factsheetTitle: string | null;
  matchMethod: MatchMethod | null; // 귀속 경로 배지용
  identitySource: IdentitySource | null; // 식별값 출처 배지용(LLM 유래는 강조)
  evaluation: WorksheetEvaluation | null; // 현재 채점 결과(미채점이면 null) — 배치 4
};

// 제출물 펼침에 표시·수정하는 기준별 채점 결과 (리팩토링 4 배치 4, P-3).
// 기준 목록은 **루브릭 순서**로 조립한다 — 편집기가 보내는 값이 루브릭과 정확히 일치해야
// 서버 검증(validateTeacherScores)을 통과하기 때문이다.
export type WorksheetEvaluation = {
  total: number; // 저장된 total_score(합계의 진실 원천)
  origin: EvaluationOrigin; // 'llm' | 'teacher'
  scores: {
    criterionId: string;
    name: string;
    score: number;
    max: number;
    evidence: string;
  }[];
};

export type WorksheetRow = {
  studentId: string; // = students.id (제품 부여 고유 번호). 셀에는 앞 8자 + title 속성으로 전문
  studentNumber: string | null;
  name: string;
  selectedBooks: { factsheetId: string; title: string }[];
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
