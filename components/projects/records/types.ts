import type { RecordOrigin, VerificationSentence } from "@/lib/supabase/types";

// 학생별 현재 생기부 뷰(서버에서 조립해 클라이언트로 전달).
export type RecordView = {
  version: number;
  content: string;
  verification: VerificationSentence[] | null;
  origin: RecordOrigin;
  model: string | null;
  createdAt: string;
};

export type StudentRow = {
  id: string;
  name: string;
  studentNumber: string | null;
  teacherMemo: string | null;
  reflectCount: number; // 반영+매칭 제출물 수(생성 근거 유무 표시)
  record: RecordView | null;
};
