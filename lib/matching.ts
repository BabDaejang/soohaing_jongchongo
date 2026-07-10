// 학생 매칭 분류 (순수 함수, SPEC 5.2). 단위 테스트 대상 — server-only 아님.
//
// 혼입 방지의 축이 "학번이 있을 때만 자동"에서 "명단과 **모호하지 않게** 일치할 때만 자동"으로
// 바뀌었다 (SPEC 5.2 개정, DECISIONS 2026-07-10). 자동 귀속은 두 경우뿐이다:
//   - 학번이 명단과 완전 일치
//   - 이름이 명단에 정확히 1명만 일치 (동명이인이면 자동 금지 — 원래 보호하려던 것이 이것이다)
// 그 외(동명이인·명단 미일치·학번 충돌·식별 불가)는 전부 교사 확인 큐로 간다.
// 자동 귀속의 오류는 재귀속(reassignSubmission)으로 되돌린다.
import type { MatchMethod } from "@/lib/supabase/types";

// 로스터 조회 결과에서 매칭에 쓰는 최소 학생 정보.
export type StudentRef = { id: string; student_number: string | null; name: string };

// 확인 대기 후보(기존 학생). 신규 생성 제안은 UI에서 별도 옵션으로 제공.
export type MatchCandidate = { student_id: string; name: string; student_number: string | null };

// 매칭에 쓴 학번·이름을 어디서 얻었나 (DATA_MODEL 8절 identity_source).
export type IdentitySource = "column" | "filename" | "llm";

export type PendingReason =
  | "name" // 이름이 동명이인이거나 명단에 없음
  | "number_unknown" // 학번이 명단에 없고, 신규 생성이 허용되지 않는 출처
  | "number_conflict" // 학번은 신규인데 이름이 명단의 다른 학생과 일치 (학번 오타 의심)
  | "none"; // 식별값 미확보

export type MatchOutcome =
  | { action: "auto_existing"; studentId: string; method: MatchMethod }
  | { action: "auto_new_number"; method: MatchMethod }
  | { action: "pending"; reason: PendingReason; candidates: MatchCandidate[] };

export type ClassifyInput = {
  rawStudentNo: string | null;
  rawStudentName: string | null;
  byNumber: StudentRef | null; // 학번 완전 일치 학생(있으면)
  byName: StudentRef[]; // 이름 완전 일치 학생들
  /** 신규 학생 자동 생성은 'column' 출처에서만 허용한다 (파일명·LLM 오타로 유령 학생이 생기는 것을 막는다). */
  identitySource: IdentitySource | null;
};

function toCandidate(s: StudentRef): MatchCandidate {
  return { student_id: s.id, name: s.name, student_number: s.student_number };
}

export function classifyMatch(input: ClassifyInput): MatchOutcome {
  const no = input.rawStudentNo?.trim() || null;
  const name = input.rawStudentName?.trim() || null;
  const nameCandidates = input.byName.map(toCandidate);

  // (a) 학번 완전 일치 — 가장 강한 증거.
  if (no && input.byNumber) {
    return { action: "auto_existing", studentId: input.byNumber.id, method: "auto_number" };
  }

  // 학번은 있는데 명단에 없다. 이름이 명단의 학생과 일치하면 학번 오타를 의심해야 한다.
  if (no && input.byName.length > 0) {
    return { action: "pending", reason: "number_conflict", candidates: nameCandidates };
  }

  // (d) 신규 학번 → 학생 자동 생성. 교사가 확정한 열 매핑에서 온 값일 때만.
  if (no) {
    if (input.identitySource === "column") {
      return { action: "auto_new_number", method: "auto_new_number" };
    }
    return { action: "pending", reason: "number_unknown", candidates: [] };
  }

  // (b) 이름이 명단에 정확히 1명만 일치 → 자동. 동명이인은 여기서 걸러진다.
  if (name) {
    if (input.byName.length === 1) {
      return { action: "auto_existing", studentId: input.byName[0].id, method: "auto_name" };
    }
    return { action: "pending", reason: "name", candidates: nameCandidates };
  }

  // (e) 식별값 없음 → 확인 대기. LLM 후보 제안은 큐에서 지연 실행.
  return { action: "pending", reason: "none", candidates: [] };
}

// ── 파일명 × 명단 교차 대조 (SPEC 5.2 identity_source='filename') ──────
//
// 학교마다 파일명 규칙이 달라 형식을 가정할 수 없다. 대신 **명단에 실재하는** 학번·이름이
// 파일명에 온전한 토큰으로 들어 있는지만 본다. 그러면 "수행평가최종.docx"의 "수행평가"는
// 명단에 없으므로 자동 탈락하고, 규칙 없이도 안전하다.

export type DerivedIdentity = {
  studentNo: string | null;
  studentName: string | null;
};

const EMPTY: DerivedIdentity = { studentNo: null, studentName: null };

// 확장자와 디렉터리를 떼어낸 파일명 본체.
export function fileBasename(filename: string): string {
  const tail = filename.split(/[\\/]/).pop() ?? filename;
  const dot = tail.lastIndexOf(".");
  return dot > 0 ? tail.slice(0, dot) : tail;
}

// needle이 haystack에 "온전한 토큰"으로 들어 있는가.
// 숫자는 앞뒤에 숫자가 붙지 않아야 하고(10203이 210203에 걸리지 않게),
// 한글은 앞뒤에 한글이 붙지 않아야 한다(이서가 이서준에 걸리지 않게).
export function containsToken(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const guard = /^\d+$/.test(needle) ? "\\d" : "가-힣";
  return new RegExp(`(?<![${guard}])${escaped}(?![${guard}])`).test(haystack);
}

// 파일명에서 명단 학생을 지목한다. 서로 다른 학생 둘 이상이 걸리면 포기(모호).
export function deriveIdentityFromFilename(
  filename: string | null,
  roster: StudentRef[],
): DerivedIdentity {
  if (!filename) return EMPTY;
  const base = fileBasename(filename);
  if (!base) return EMPTY;

  const byNumber = roster.filter(
    (s) => s.student_number && containsToken(base, s.student_number),
  );
  const byName = roster.filter((s) => s.name && containsToken(base, s.name));

  // 같은 학생을 학번·이름 양쪽으로 가리켜도 한 명이다.
  const hits = new Map<string, StudentRef>();
  for (const s of [...byNumber, ...byName]) hits.set(s.id, s);
  if (hits.size !== 1) return EMPTY; // 0명(미검출) 또는 2명 이상(모호) → 큐로

  const student = [...hits.values()][0];
  return {
    // 지목된 학생의 값만 돌려준다 — 파일명에 실제로 등장한 토큰에 한해.
    studentNo:
      student.student_number && containsToken(base, student.student_number)
        ? student.student_number
        : null,
    studentName: containsToken(base, student.name) ? student.name : null,
  };
}
