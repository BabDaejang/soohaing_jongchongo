// DB 행 타입 수동 정의 (docs/DATA_MODEL.md).
// 스키마가 커지면 supabase gen types 도입을 검토한다.
// 주의: postgrest-js의 Record<string, unknown> 제약(암시적 인덱스 시그니처) 때문에
// interface가 아닌 type 별칭으로 선언해야 한다.

import type { ModelRouting } from "@/lib/llm/types";

export type ProfileRole = "admin" | "user";
export type ProfileStatus = "pending" | "approved" | "rejected";

export type Profile = {
  id: string;
  email: string;
  name: string | null;
  role: ProfileRole;
  status: ProfileStatus;
  created_at: string;
  updated_at: string | null;
};

export type AppSetting = {
  key: string;
  value: unknown;
  updated_at: string | null;
  updated_by: string | null;
};

// providers (DATA_MODEL 3절). api_format은 어댑터 분기 키.
export type ApiFormat = "anthropic" | "openai" | "google";

export type Provider = {
  id: string;
  name: string;
  base_url: string | null;
  api_format: ApiFormat;
  is_seed: boolean;
  created_at: string;
};

// api_keys (DATA_MODEL 4절, INV-4).
// encrypted_key는 서버 전용 — 클라이언트용 쿼리는 이 컬럼을 select 하지 않는다.
export type ApiKey = {
  id: string;
  provider_id: string;
  owner_id: string | null; // NULL = 관리자 등록 기본 키
  encrypted_key: string;
  key_last4: string;
  created_at: string;
  updated_at: string | null;
};

// audit_logs (DATA_MODEL 14절, append-only). insert는 service role 전용.
export type AuditLog = {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: unknown;
  created_at: string;
};

// projects (DATA_MODEL 5절). 설정 컬럼의 유니온 타입.
export type GradingScheme = "grade5" | "grade9";
export type CountMethod = "chars" | "bytes";
export type ScoreAggregation = "sum" | "avg" | "weighted";
export type TieBreak = "best_grade" | "mid_rank";
export type FileRetentionDays = 7 | 30 | null;

export type Project = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  grading_scheme: GradingScheme;
  char_limit: number;
  count_method: CountMethod;
  score_aggregation: ScoreAggregation;
  tie_break: TieBreak;
  file_retention_days: FileRetentionDays;
  model_routing: ModelRouting;
  created_at: string;
  updated_at: string | null;
};

// 프로젝트 설정 편집 시 함께 갱신되는 필드(이름·설명 제외).
export type ProjectSettings = Pick<
  Project,
  | "grading_scheme"
  | "char_limit"
  | "count_method"
  | "score_aggregation"
  | "tie_break"
  | "file_retention_days"
>;

// rubrics (DATA_MODEL 6절). criteria 배열 원소.
export type RubricCriterion = {
  id: string;
  name: string;
  description: string;
  max_score: number;
  weight: number;
};

export type Rubric = {
  id: string;
  project_id: string;
  criteria: RubricCriterion[];
  created_at: string;
  updated_at: string | null;
};

// students (DATA_MODEL 7절). score_override/override_reason는 세션 7에서 추가.
export type Student = {
  id: string;
  project_id: string;
  student_number: string | null;
  name: string;
  teacher_memo: string | null;
  created_at: string;
  updated_at: string | null;
};

// submissions (DATA_MODEL 8절). 세션 5: 스테이징(student_id NULL, match_status='unmatched').
export type SubmissionSourceType =
  | "xlsx"
  | "csv"
  | "docx"
  | "pdf_text"
  | "pdf_scan"
  | "image"
  | "manual";
export type MatchStatus =
  | "unmatched"
  | "auto_matched"
  | "pending_confirm"
  | "confirmed"
  | "update_pending";

export type Submission = {
  id: string;
  project_id: string;
  student_id: string | null;
  raw_student_no: string | null;
  raw_student_name: string | null;
  submission_key: string | null;
  source_filename: string | null;
  content_text: string;
  content_hash: string;
  source_type: SubmissionSourceType;
  storage_path: string | null;
  match_status: MatchStatus;
  match_candidates: unknown;
  pending_content: unknown;
  include_in_eval: boolean;
  include_in_record: boolean;
  extraction_approved_at: string | null;
  created_at: string;
  updated_at: string | null;
};

// Supabase 클라이언트 제네릭용 스키마 타입.
// profiles Insert는 never — 생성 경로는 auth 트리거(handle_new_user)뿐이다.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: never;
        Update: Partial<Pick<Profile, "name" | "role" | "status">>;
        Relationships: [];
      };
      app_settings: {
        Row: AppSetting;
        Insert: { key: string; value: unknown; updated_by?: string | null };
        Update: Partial<Omit<AppSetting, "key">>;
        Relationships: [];
      };
      providers: {
        Row: Provider;
        Insert: {
          name: string;
          api_format: ApiFormat;
          base_url?: string | null;
          is_seed?: boolean;
        };
        Update: Partial<Pick<Provider, "name" | "base_url" | "api_format">>;
        Relationships: [];
      };
      api_keys: {
        Row: ApiKey;
        Insert: {
          provider_id: string;
          owner_id?: string | null;
          encrypted_key: string;
          key_last4: string;
        };
        Update: Partial<Pick<ApiKey, "encrypted_key" | "key_last4">>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLog;
        Insert: {
          actor_id?: string | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          detail?: unknown;
        };
        Update: never;
        Relationships: [];
      };
      projects: {
        Row: Project;
        // model_routing은 SQL default가 없으므로 삽입 시 필수 (앱에서 조립).
        Insert: {
          owner_id: string;
          name: string;
          model_routing: ModelRouting;
          description?: string | null;
          grading_scheme?: GradingScheme;
          char_limit?: number;
          count_method?: CountMethod;
          score_aggregation?: ScoreAggregation;
          tie_break?: TieBreak;
          file_retention_days?: FileRetentionDays;
        };
        Update: Partial<
          Pick<
            Project,
            | "name"
            | "description"
            | "grading_scheme"
            | "char_limit"
            | "count_method"
            | "score_aggregation"
            | "tie_break"
            | "file_retention_days"
            | "model_routing"
          >
        >;
        Relationships: [];
      };
      rubrics: {
        Row: Rubric;
        Insert: { project_id: string; criteria: RubricCriterion[] };
        Update: Partial<Pick<Rubric, "criteria">>;
        Relationships: [];
      };
      students: {
        Row: Student;
        Insert: {
          project_id: string;
          name: string;
          student_number?: string | null;
          teacher_memo?: string | null;
        };
        Update: Partial<
          Pick<Student, "name" | "student_number" | "teacher_memo">
        >;
        Relationships: [];
      };
      submissions: {
        Row: Submission;
        Insert: {
          project_id: string;
          content_text: string;
          content_hash: string;
          source_type: SubmissionSourceType;
          student_id?: string | null;
          raw_student_no?: string | null;
          raw_student_name?: string | null;
          submission_key?: string | null;
          source_filename?: string | null;
          storage_path?: string | null;
          match_status?: MatchStatus;
          match_candidates?: unknown;
          pending_content?: unknown;
          include_in_eval?: boolean;
          include_in_record?: boolean;
        };
        Update: Partial<
          Pick<
            Submission,
            | "content_text"
            | "content_hash"
            | "source_type"
            | "match_status"
            | "pending_content"
            | "storage_path"
            | "raw_student_no"
            | "raw_student_name"
            | "include_in_eval"
            | "include_in_record"
          >
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
