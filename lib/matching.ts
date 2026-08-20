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

// ── 발견(discovery) — 명단 **없이** 식별값을 찾는 경로 (리팩토링 4 배치 2, P-1) ──
//
// 위의 deriveIdentityFromFilename·extractIdentityByLLM은 둘 다 "명단과 대조"가 전제라
// 명단이 비어 있으면 아무도 발견하지 못한다(닭-달걀). 발견 경로는 명단을 전제하지 않고
// 후보 식별값만 뽑아 raw_*에 적어 두고, **학생 생성은 교사 승인(createDiscoveredStudents)에
// 맡긴다.** 여기서 자동으로 학생을 만들지 않는 것이 유령 학생 방지의 핵심이다.

// 파일명에서 이름 후보로 쓰지 않을 상용어. 교사가 검토 화면에서 거르므로 최소만 둔다.
const FILENAME_STOPWORDS: ReadonlySet<string> = new Set([
  "수행평가", "수행", "평가", "과제", "제출", "보고서", "발표", "활동", "독서",
  "기록", "최종", "최종본", "초안", "사본", "복사본", "양식", "서식", "학년",
  "학기", "이름", "학번", "우수작", "결과", "자료",
]);

export type FilenameIdentityCandidates = {
  no: string | null; // 4~6자리 숫자 토큰이 정확히 1개일 때만
  nameCandidates: string[]; // 한글 2~4자 토큰(상용어 제외), 등장 순서
};

// 파일명에서 식별값 **후보**를 뽑는다. 명단을 보지 않으므로 확정이 아니라 후보다.
// 숫자·한글의 "온전한 토큰" 경계는 최대 연속 구간으로 자연히 보장된다
// (예: 1234567은 7자리 한 덩어리라 4~6자리 후보가 되지 않는다 — containsToken과 같은 규칙).
export function extractIdentityCandidatesFromFilename(
  filename: string | null,
): FilenameIdentityCandidates {
  if (!filename) return { no: null, nameCandidates: [] };
  const base = fileBasename(filename);
  if (!base) return { no: null, nameCandidates: [] };

  const digitRuns = base.match(/\d+/g) ?? [];
  const numbers = digitRuns.filter((d) => d.length >= 4 && d.length <= 6);
  // 둘 이상이면 어느 것이 학번인지 결정할 수 없다 → 포기(보수 원칙).
  const no = numbers.length === 1 ? numbers[0] : null;

  const hangulRuns = base.match(/[가-힣]+/g) ?? [];
  const nameCandidates: string[] = [];
  for (const token of hangulRuns) {
    if (token.length < 2 || token.length > 4) continue;
    if (FILENAME_STOPWORDS.has(token)) continue;
    if (!nameCandidates.includes(token)) nameCandidates.push(token);
  }

  return { no, nameCandidates };
}

// LLM이 뽑아 온 식별값이 **문서에 실제로 존재하는 토큰인지** 대조한다.
// 팩트시트의 filterBySnippetMatch와 같은 구조적 할루시네이션 차단 — 원문에 없는 값은 버린다.
export function verifyIdentityTokens(
  head: string,
  extracted: { no: string | null; name: string | null },
): { no: string | null; name: string | null } {
  const no = extracted.no?.trim() || null;
  const name = extracted.name?.trim() || null;
  return {
    no: no && containsToken(head, no) ? no : null,
    name: name && containsToken(head, name) ? name : null,
  };
}

// 발견 집계 입력 1행(미귀속 제출물의 raw 식별값).
export type DiscoveredIdentityRow = {
  submissionId: string;
  no: string | null;
  name: string | null;
  source: IdentitySource | null;
};

// 교사 검토 화면의 행 = 명단에 없는 학생 후보 1명.
export type DiscoveredStudent = {
  no: string | null;
  name: string | null; // 대표 이름(최다 등장), 이름이 전혀 없으면 null
  submissionIds: string[];
  sources: IdentitySource[];
  conflict: string[]; // 같은 학번에 서로 다른 이름이 모였을 때만 채운다(2개 이상)
};

// 미귀속 제출물의 raw 식별값을 학생 후보로 묶는다. 그룹 키는 학번 우선, 없으면 이름.
// **이미 명단에 있는 학생은 제외한다** — 발견의 목적은 신규 학생 후보를 찾는 것이고,
// 명단에 있는 이름·학번의 귀속은 매칭·확인 큐가 할 일이다.
export function aggregateDiscoveredIdentities(
  rows: DiscoveredIdentityRow[],
  roster: StudentRef[],
): DiscoveredStudent[] {
  const rosterNumbers = new Set(
    roster.map((s) => s.student_number?.trim()).filter((n): n is string => !!n),
  );
  const rosterNames = new Set(
    roster.map((s) => s.name.trim()).filter((n) => n.length > 0),
  );

  type Bucket = {
    no: string | null;
    names: Map<string, number>; // 이름 → 등장 횟수
    submissionIds: string[];
    sources: Set<IdentitySource>;
  };
  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const no = row.no?.trim() || null;
    const name = row.name?.trim() || null;
    if (!no && !name) continue;

    const key = no ? `no:${no}` : `name:${name}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { no, names: new Map(), submissionIds: [], sources: new Set() };
      buckets.set(key, bucket);
    }
    if (name) bucket.names.set(name, (bucket.names.get(name) ?? 0) + 1);
    if (!bucket.submissionIds.includes(row.submissionId)) {
      bucket.submissionIds.push(row.submissionId);
    }
    if (row.source) bucket.sources.add(row.source);
  }

  const out: DiscoveredStudent[] = [];
  for (const bucket of buckets.values()) {
    // 최다 등장 순, 동수면 가나다순 — 대표 이름을 결정적으로 고른다.
    const names = [...bucket.names.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
      .map(([n]) => n);

    if (bucket.no && rosterNumbers.has(bucket.no)) continue; // 학번이 명단에 있음
    if (names.some((n) => rosterNames.has(n))) continue; // 이름이 명단에 있음

    out.push({
      no: bucket.no,
      name: names[0] ?? null,
      submissionIds: bucket.submissionIds,
      sources: [...bucket.sources],
      conflict: names.length >= 2 ? names : [],
    });
  }

  // 학번 있는 후보 먼저(학번 오름차순), 그다음 이름순 — 검토 화면 정렬을 고정한다.
  return out.sort((a, b) => {
    if (a.no && b.no) return a.no.localeCompare(b.no, "ko");
    if (a.no) return -1;
    if (b.no) return 1;
    return (a.name ?? "").localeCompare(b.name ?? "", "ko");
  });
}
