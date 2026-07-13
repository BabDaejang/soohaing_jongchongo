// 작업결과표 행 조립 — **순수·주입식**(server-only 아님). 페이지(server component)와
// 액션(fetchWorksheetRows)이 각자 4쿼리를 돌린 뒤 이 함수로 동일하게 조립한다
// (조립 로직 중복 금지). 기본 정렬: 학번 asc(null 끝) · 이름 asc.

import type { WorksheetRow, WorksheetSubmission } from "./types";

export type StudentRaw = {
  id: string;
  student_number: string | null;
  name: string;
  teacher_memo: string | null;
  score_override: number | null;
  override_reason: string | null;
};
export type SubmissionRaw = {
  id: string;
  student_id: string | null;
  source_filename: string | null;
  submission_key: string | null;
};
export type ScoreRaw = {
  student_id: string;
  display_score: number | null;
  grade: number | null;
};
export type RecordRaw = {
  student_id: string;
  content: string;
  version: number;
};

export function assembleWorksheetRows(input: {
  students: StudentRaw[];
  submissions: SubmissionRaw[];
  scores: ScoreRaw[];
  records: RecordRaw[];
}): WorksheetRow[] {
  const subsByStudent = new Map<string, WorksheetSubmission[]>();
  for (const s of input.submissions) {
    if (!s.student_id) continue; // 귀속분(student_id NOT NULL)만
    const title = s.source_filename ?? s.submission_key ?? s.id.slice(0, 8);
    const list = subsByStudent.get(s.student_id);
    if (list) list.push({ id: s.id, title });
    else subsByStudent.set(s.student_id, [{ id: s.id, title }]);
  }

  const scoreByStudent = new Map(input.scores.map((s) => [s.student_id, s]));
  const recordByStudent = new Map(input.records.map((r) => [r.student_id, r]));

  const rows: WorksheetRow[] = input.students.map((st) => {
    const subs = subsByStudent.get(st.id) ?? [];
    const score = scoreByStudent.get(st.id) ?? null;
    const rec = recordByStudent.get(st.id) ?? null;
    const display = score?.display_score ?? null;
    return {
      studentId: st.id,
      studentNumber: st.student_number,
      name: st.name,
      submissionCount: subs.length,
      submissions: subs,
      displayScore: st.score_override ?? display,
      hasOverride: st.score_override != null,
      overrideReason: st.override_reason,
      grade: score?.grade ?? null,
      recordContent: rec?.content ?? null,
      recordVersion: rec?.version ?? null,
      memo: st.teacher_memo ?? "",
    };
  });

  return sortDefault(rows);
}

// 기본 정렬: 학번 오름차순(null 끝) → 이름 오름차순.
function sortDefault(rows: WorksheetRow[]): WorksheetRow[] {
  return [...rows].sort((a, b) => {
    if (a.studentNumber !== b.studentNumber) {
      if (a.studentNumber === null) return 1;
      if (b.studentNumber === null) return -1;
      return a.studentNumber.localeCompare(b.studentNumber, "ko");
    }
    return a.name.localeCompare(b.name, "ko");
  });
}
