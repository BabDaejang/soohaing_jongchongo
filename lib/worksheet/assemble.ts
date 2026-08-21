// 작업결과표 행 조립 — **순수·주입식**(server-only 아님). 페이지(server component)와
// 액션(fetchWorksheetRows)이 각자 4쿼리를 돌린 뒤 이 함수로 동일하게 조립한다
// (조립 로직 중복 금지). 기본 정렬: 학번 asc(null 끝) · 이름 asc.

import type {
  AuthenticityStatus,
  EvaluationCriterionScore,
  EvaluationOrigin,
  IdentitySource,
  MatchMethod,
  RubricCriterion,
} from "@/lib/supabase/types";
import type {
  WorksheetEvaluation,
  WorksheetRow,
  WorksheetSubmission,
} from "./types";

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
  authenticity_status: AuthenticityStatus;
  content_text?: string | null;
  source_type?: string | null;
  factsheet_id?: string | null;
  authenticity?: unknown;
  factsheets?: unknown; // Single join result: { title: string } | null or arrays depending on schema mapping
  // 리팩토링 4 배치 3 — 선택 필드라 기존 호출부(미전달)는 null로 떨어진다(하위 호환).
  match_method?: MatchMethod | null;
  identity_source?: IdentitySource | null;
};
// 현재 평가(is_current) 1행. 배치 4 — 없으면 미채점.
export type EvaluationRaw = {
  submission_id: string;
  scores: EvaluationCriterionScore[];
  total_score: number;
  origin: EvaluationOrigin;
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
  // 배치 4 — 선택 인자라 넘기지 않는 호출부는 evaluation: null로 떨어진다(하위 호환).
  evaluations?: EvaluationRaw[];
  criteria?: RubricCriterion[];
}): WorksheetRow[] {
  const criteria = input.criteria ?? [];
  const evalBySub = new Map<string, EvaluationRaw>();
  for (const e of input.evaluations ?? []) evalBySub.set(e.submission_id, e);

  // 기준 목록은 루브릭 순서로 세운다(편집기 입력이 루브릭과 1:1이어야 서버 검증을 통과한다).
  // 루브릭에서 사라진 기준의 점수는 목록에 넣지 않는다 — 합계는 저장된 total_score를 쓴다.
  function toEvaluation(subId: string): WorksheetEvaluation | null {
    const e = evalBySub.get(subId);
    if (!e) return null;
    const byId = new Map(e.scores.map((s) => [s.criterion_id, s]));
    return {
      total: e.total_score,
      origin: e.origin,
      scores: criteria.map((c) => {
        const found = byId.get(c.id);
        return {
          criterionId: c.id,
          name: c.name,
          score: found?.score ?? 0,
          max: c.max_score,
          evidence: found?.evidence_quote ?? "",
        };
      }),
    };
  }

  const subsByStudent = new Map<string, WorksheetSubmission[]>();
  for (const s of input.submissions) {
    if (!s.student_id) continue; // 귀속분(student_id NOT NULL)만
    
    let title = s.source_filename ?? s.submission_key ?? s.id.slice(0, 8);
    if ((s.source_type === "xlsx" || s.source_type === "csv") && s.submission_key?.includes("::")) {
      title = s.submission_key.split("::")[0];
    }
    
    let factsheetTitle: string | null = null;
    if (s.factsheets && typeof s.factsheets === "object" && "title" in s.factsheets) {
      factsheetTitle = (s.factsheets as { title: string }).title;
    } else {
      const auth = s.authenticity as Record<string, any> | null;
      if (auth?.claim?.title) {
        factsheetTitle = auth.claim.title;
      }
    }
    
    const entry: WorksheetSubmission = {
      id: s.id,
      title,
      authenticityStatus: s.authenticity_status,
      contentText: s.content_text ?? "",
      factsheetId: s.factsheet_id ?? null,
      factsheetTitle,
      matchMethod: s.match_method ?? null,
      identitySource: s.identity_source ?? null,
      evaluation: toEvaluation(s.id),
    };
    const list = subsByStudent.get(s.student_id);
    if (list) list.push(entry);
    else subsByStudent.set(s.student_id, [entry]);
  }

  const scoreByStudent = new Map(input.scores.map((s) => [s.student_id, s]));
  const recordByStudent = new Map(input.records.map((r) => [r.student_id, r]));

  const rows: WorksheetRow[] = input.students.map((st) => {
    const subs = subsByStudent.get(st.id) ?? [];
    const score = scoreByStudent.get(st.id) ?? null;
    const rec = recordByStudent.get(st.id) ?? null;
    const display = score?.display_score ?? null;
    
    // 조립: 중복 없이 도서 목록 추출
    const selectedBooksMap = new Map<string, string>();
    for (const sub of subs) {
      if (sub.factsheetId && sub.factsheetTitle) {
        selectedBooksMap.set(sub.factsheetId, sub.factsheetTitle);
      }
    }
    const selectedBooks = Array.from(selectedBooksMap.entries()).map(([factsheetId, title]) => ({
      factsheetId,
      title,
    }));

    return {
      studentId: st.id,
      studentNumber: st.student_number,
      name: st.name,
      selectedBooks,
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
