// 학생 매칭 분류 (순수 함수, SPEC 5.2). 단위 테스트 대상 — server-only 아님.
//
// 혼입 방지의 핵심: **학번(raw_student_no)이 있을 때만 자동 귀속**한다.
// 이름만 있거나(동명이인 보호) 식별값이 없으면 무조건 확인 대기(pending) — 자동 병합 경로가 구조적으로 없다.
import type { MatchMethod } from "@/lib/supabase/types";

// 로스터 조회 결과에서 매칭에 쓰는 최소 학생 정보.
export type StudentRef = { id: string; student_number: string | null; name: string };

// 확인 대기 후보(기존 학생). 신규 생성 제안은 UI에서 별도 옵션으로 제공.
export type MatchCandidate = { student_id: string; name: string; student_number: string | null };

export type MatchOutcome =
  | { action: "auto_existing"; studentId: string; method: MatchMethod }
  | { action: "auto_new_number"; method: MatchMethod }
  | { action: "pending"; reason: "name" | "none"; candidates: MatchCandidate[] };

export type ClassifyInput = {
  rawStudentNo: string | null;
  rawStudentName: string | null;
  byNumber: StudentRef | null; // 학번 완전 일치 학생(있으면)
  byName: StudentRef[]; // 이름 완전 일치 학생들
};

function toCandidate(s: StudentRef): MatchCandidate {
  return { student_id: s.id, name: s.name, student_number: s.student_number };
}

export function classifyMatch(input: ClassifyInput): MatchOutcome {
  const no = input.rawStudentNo?.trim();
  const name = input.rawStudentName?.trim();

  // (a)/(d): 학번이 있을 때만 자동.
  if (no) {
    if (input.byNumber) {
      return { action: "auto_existing", studentId: input.byNumber.id, method: "auto_number" };
    }
    // (d) 신규 학번 검출 → 학생 자동 생성 후 귀속 (SPEC 5.2-d)
    return { action: "auto_new_number", method: "auto_new_number" };
  }

  // (b): 이름만 → 자동 금지, 확인 대기(동명이인 보호). 이름 일치 학생을 후보로 제시.
  if (name) {
    return { action: "pending", reason: "name", candidates: input.byName.map(toCandidate) };
  }

  // (c): 식별값 없음 → 확인 대기. LLM 후보 제안은 확인 큐에서 지연 실행.
  return { action: "pending", reason: "none", candidates: [] };
}
