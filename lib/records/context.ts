import "server-only";
// 생성 컨텍스트 조립 (SPEC 7.2, INV-1/INV-2). **핵심 방어선.**
//   - buildStudentContext는 시그니처부터 단일 studentId만 받는다(학생 배열 변형 없음 = INV-1).
//   - 컨텍스트는 student_id 필터로만 조립되며, 다른 학생 데이터가 섞일 경로가 없다(INV-2).
//   - 반영 체크(include_in_record) + 매칭 확정(auto_matched/confirmed) 제출물만 포함한다.
//   테스트 가능성을 위해 데이터 접근을 ContextSource로 주입한다(resolveApiKey 패턴).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CountMethod, Database, MatchStatus } from "@/lib/supabase/types";
import { mergeProfileLayers, type MergedProfile } from "./profile";

type Client = SupabaseClient<Database>;

// 반영 컨텍스트 대상: 반영 체크 + 매칭 확정 + 학생 귀속 제출물만(혼입 방지 — 평가와 동일 기준).
const MATCHED_STATUSES: MatchStatus[] = ["auto_matched", "confirmed"];

// filterRecordSubmissions 입력 행(필터에 필요한 필드만).
export type RecordSubmissionRow = {
  id: string;
  content_text: string;
  source_type: string;
  student_id: string | null;
  include_in_record: boolean;
  match_status: MatchStatus;
};

export type ContextSubmission = {
  id: string;
  content_text: string;
  source_type: string;
};

// 순수 필터 — 해당 학생 귀속 + 반영 + 매칭 확정 제출물만 남긴다.
// (DB 쿼리가 이미 student_id로 스코프하지만, 코드 레벨에서 한 번 더 방어한다 — 교차오염 단위 테스트 대상.)
export function filterRecordSubmissions(
  subs: RecordSubmissionRow[],
  studentId: string,
): ContextSubmission[] {
  return subs
    .filter(
      (s) =>
        s.student_id === studentId &&
        s.include_in_record &&
        MATCHED_STATUSES.includes(s.match_status),
    )
    .map((s) => ({
      id: s.id,
      content_text: s.content_text,
      source_type: s.source_type,
    }));
}

export type StudentContext = {
  studentId: string;
  studentName: string;
  projectId: string;
  submissions: ContextSubmission[];
  teacherMemo: string | null; // 해당 학생 레코드 귀속분만 (INV-2 예외 경로)
  guidelines: MergedProfile["guidelines"];
  prohibitions: MergedProfile["prohibitions"];
  charLimit: number;
  countMethod: CountMethod;
};

// 주입형 데이터 접근 — 실제 구현은 Supabase, 테스트는 가짜 소스.
export interface ContextSource {
  getStudent(studentId: string): Promise<{
    id: string;
    name: string;
    teacher_memo: string | null;
    project_id: string;
  } | null>;
  // 반드시 student_id로 스코프해 조회한다(구조적 INV-2).
  listStudentSubmissions(studentId: string): Promise<RecordSubmissionRow[]>;
  getMergedProfile(projectId: string): Promise<MergedProfile>;
  getRecordSettings(
    projectId: string,
  ): Promise<{ charLimit: number; countMethod: CountMethod } | null>;
}

// 단일 학생의 생성 컨텍스트를 조립한다 (INV-1: studentId 하나만 받는다).
export async function buildStudentContext(
  studentId: string,
  source: ContextSource,
): Promise<StudentContext> {
  const student = await source.getStudent(studentId);
  if (!student) throw new Error("학생을 찾을 수 없습니다.");

  const rawSubs = await source.listStudentSubmissions(studentId);
  const submissions = filterRecordSubmissions(rawSubs, studentId); // 방어적 재필터

  const profile = await source.getMergedProfile(student.project_id);
  const settings = await source.getRecordSettings(student.project_id);

  return {
    studentId: student.id,
    studentName: student.name,
    projectId: student.project_id,
    submissions,
    teacherMemo: student.teacher_memo,
    guidelines: profile.guidelines,
    prohibitions: profile.prohibitions,
    charLimit: settings?.charLimit ?? 500,
    countMethod: settings?.countMethod ?? "chars",
  };
}

// 실제 Supabase 기반 ContextSource. 소유자 세션 클라이언트로 RLS 스코프된 조회만 한다.
//   - submissions/students/projects: owns_project RLS로 소유 프로젝트만.
//   - prompt_profiles: owner_id = auth.uid() RLS로 본인 프로필만.
// ownerId는 프롬프트 프로필 계층 조회에 사용한다(계정 기본 + 프로젝트 오버라이드).
export function createSupabaseContextSource(
  supabase: Client,
  ownerId: string,
): ContextSource {
  return {
    async getStudent(studentId) {
      const { data } = await supabase
        .from("students")
        .select("id, name, teacher_memo, project_id")
        .eq("id", studentId)
        .maybeSingle();
      return data ?? null;
    },
    async listStudentSubmissions(studentId) {
      // 구조적 INV-2: student_id 필터로만 조회한다.
      const { data } = await supabase
        .from("submissions")
        .select(
          "id, content_text, source_type, student_id, include_in_record, match_status",
        )
        .eq("student_id", studentId);
      return data ?? [];
    },
    async getMergedProfile(projectId) {
      const { data } = await supabase
        .from("prompt_profiles")
        .select("project_id, guidelines, prohibitions")
        .eq("owner_id", ownerId)
        .or(`project_id.is.null,project_id.eq.${projectId}`);
      const rows = data ?? [];
      const account = rows.find((r) => r.project_id === null) ?? null;
      const override = rows.find((r) => r.project_id === projectId) ?? null;
      return mergeProfileLayers(account, override);
    },
    async getRecordSettings(projectId) {
      const { data } = await supabase
        .from("projects")
        .select("char_limit, count_method")
        .eq("id", projectId)
        .maybeSingle();
      if (!data) return null;
      return { charLimit: data.char_limit, countMethod: data.count_method };
    },
  };
}
