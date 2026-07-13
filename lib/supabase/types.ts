// DB 행 타입 수동 정의 (docs/DATA_MODEL.md).
// 스키마가 커지면 supabase gen types 도입을 검토한다.
// 주의: postgrest-js의 Record<string, unknown> 제약(암시적 인덱스 시그니처) 때문에
// interface가 아닌 type 별칭으로 선언해야 한다.

import type { ModelRouting } from "@/lib/llm/types";
import type { WorksheetLayout } from "@/lib/worksheet/layout";

// ui_layouts.layout에 저장되는 레이아웃 형태(신뢰 경계 — 항상 normalize 후 저장).
// 구 결과 표(/results)는 배치 4에서 제거되어 작업결과표만 이 행을 사용한다.
type StoredLayout = WorksheetLayout;

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
  models: string[]; // 이 키로 조회한 모델 ID 목록 (SPEC 3절)
  models_synced_at: string | null;
  created_at: string;
  updated_at: string | null;
};

// api_keys 행 중 화면에 노출해도 되는 부분 (평문·암호문 제외). 계정 옵션·관리자 패널 공용.
export type KeyStatus = {
  last4: string;
  models: string[];
  syncedAt: string | null;
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
  needs_recalc: boolean; // "재계산 필요" 배지 (세션 7). 트리거·설정 변경 시 true, 배치가 false.
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
// 교사 개입(순위 재배치)은 이 override로만 — 등급 직접 수정 없음(INV-6). 사유 필수(DB check).
export type Student = {
  id: string;
  project_id: string;
  student_number: string | null;
  name: string;
  teacher_memo: string | null;
  score_override: number | null;
  override_reason: string | null;
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

// 귀속 경로 (0005, 0011로 확장). 미귀속/대기 시 NULL.
export type MatchMethod =
  | "auto_number" // 학번이 명단과 완전 일치
  | "auto_name" // 이름이 명단에 정확히 1명만 일치 (0011)
  | "auto_new_number" // column 출처 신규 학번 → 학생 자동 생성
  | "confirmed_existing"
  | "confirmed_new"
  | "manual"
  | "reassigned"; // 교사가 다른 학생으로 이동 (0011)

// 매칭에 쓴 학번·이름의 출처 (0011, SPEC 5.2).
export type IdentitySource = "column" | "filename" | "llm";

// 제출물 진실성 상태 (0013, 리팩토링 2 배치 8 스키마·배치 10 소비).
export type AuthenticityStatus =
  | "unverified" // 초기
  | "not_applicable" // 출처 인용 없음
  | "verified" // 확인
  | "suspect" // 의심(플래그만 — 자동 감점·제외 없음)
  | "unverifiable"; // 판정 불가

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
  match_method: MatchMethod | null;
  identity_source: IdentitySource | null;
  match_candidates: unknown;
  pending_content: unknown;
  include_in_eval: boolean;
  include_in_record: boolean;
  extraction_approved_at: string | null;
  authenticity_status: AuthenticityStatus; // 0013 (배치 10 소비)
  authenticity: unknown; // 진실성 검증 근거·리포트(배치 10)
  factsheet_id: string | null; // 대조에 쓴 도서팩트시트(배치 10)
  created_at: string;
  updated_at: string | null;
};

// evaluations (DATA_MODEL 9절). 제출물 단위 LLM 채점. 쓰기는 service role 전용(INV-6).
export type EvaluationCriterionScore = {
  criterion_id: string;
  score: number;
  evidence_quote: string; // 근거 인용 필수 (SPEC 6절)
};

export type Evaluation = {
  id: string;
  submission_id: string;
  project_id: string;
  scores: EvaluationCriterionScore[];
  total_score: number;
  content_hash: string; // 채점 당시 제출물 해시 — 증분 재평가 판정
  raw_llm_output: string;
  model: string;
  is_current: boolean;
  created_at: string;
};

// student_scores (DATA_MODEL 10절). 합성 점수·순위·등급 스냅샷. 쓰기는 service role 배치 전용(INV-6).
export type StudentScore = {
  id: string;
  project_id: string;
  student_id: string;
  composite_score: number; // 원점수(루브릭 합성)
  display_score: number | null; // 999점 표시 점수 (0012, sticky). 미확정·override만 있는 학생은 null
  effective_score: number; // coalesce(students.score_override, display_score) — 순위·등급 산출
  rank: number;
  grade: number; // 파생 등급 스냅샷 (토글 즉시 반영은 lib/grading 파생으로)
  calculated_at: string;
};

// records (DATA_MODEL 11절, INV-1~3). 생기부 버전 관리.
//   origin: 'generated'(LLM 생성, service role write) / 'edited'(교사 편집) / 'manual'(교사 수동 작성).
//   팩의 edited_by_teacher는 origin='edited'로 실현한다 (DECISIONS 2026-07-09).
export type RecordOrigin = "generated" | "edited" | "manual";

// 검증 패스 결과 항목 (DATA_MODEL 11절). grounded=false 문장이 UI 하이라이트 대상.
//   grounded_by_memo: 제출물이 아닌 교사 메모에 근거한 경우(source_submission_ids는 빈 배열).
//   teacher_edited: 교사가 직접 수정한 문장(검증 재실행 보류 — 하이라이트 제외, '교사 편집' 표시).
export type VerificationSentence = {
  sentence: string;
  grounded: boolean;
  source_submission_ids: string[];
  grounded_by_memo?: boolean;
  teacher_edited?: boolean;
};

export type StudentRecord = {
  id: string;
  project_id: string;
  student_id: string;
  version: number;
  content: string;
  sources: string[]; // 근거 제출물 id 목록 (INV-3). uuid[]
  teacher_memo_used: boolean;
  verification: VerificationSentence[] | null;
  model: string | null;
  origin: RecordOrigin;
  is_current: boolean;
  created_at: string;
};

// prompt_profiles (DATA_MODEL 12절). 계정 기본(project_id NULL) + 프로젝트 오버라이드.
export type ProfileItem = { id: string; text: string };

export type PromptProfile = {
  id: string;
  owner_id: string;
  project_id: string | null; // NULL = 계정 기본 프로필
  guidelines: ProfileItem[]; // 작성 참고사항
  prohibitions: ProfileItem[]; // 금지사항
  version: number; // 저장/예시반영/가져오기/복원 시 +1 (세션 8a 확장)
  created_at: string;
  updated_at: string | null;
};

// prompt_profile_versions (세션 8a 확장, 0008). 프로필 스냅샷 이력(append-only).
export type ProfileVersionSource =
  | "seed"
  | "edit"
  | "ingest"
  | "import"
  | "restore";

export type PromptProfileVersion = {
  id: string;
  profile_id: string;
  owner_id: string;
  project_id: string | null;
  version: number;
  guidelines: ProfileItem[];
  prohibitions: ProfileItem[];
  source: ProfileVersionSource;
  created_at: string;
};

// ui_layouts (DATA_MODEL 13절, 세션 8b). 작업결과표 레이아웃 저장 — (user_id, project_id)당 1행.
// layout jsonb는 저장 시·읽을 때 항상 normalizeWorksheetLayout으로 검증한다(신뢰 경계) → Row는 unknown.
export type UiLayout = {
  id: string;
  user_id: string;
  project_id: string;
  layout: unknown;
  updated_at: string;
};

// factsheets (DATA_MODEL 15절, 리팩토링 2 배치 8, 0013). 도서팩트시트 — 계정 단위.
export type ShareStatus = "private" | "pending_review" | "shared" | "rejected";

export type Factsheet = {
  id: string;
  owner_id: string;
  isbn13: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  pub_year: string | null;
  toc: string | null; // 알라딘 목차 원본(HTML 제거) — LLM 비경유
  intro: string | null; // 책 소개 원본 — LLM 비경유
  cover_url: string | null;
  share_status: ShareStatus;
  review: unknown; // 관리자 AI 엄격 검증 리포트(배치 11)
  reviewed_by: string | null;
  reviewed_at: string | null;
  forked_from: string | null;
  created_at: string;
  updated_at: string | null;
};

// factsheet_entries (DATA_MODEL 15-1절, 0013). 챕터별 사실 항목.
//   수집 원문 스니펫 대조를 통과한 것만 저장(배치 9). 메타(toc·intro)는 LLM 비경유.
export type FactsheetSourceType =
  | "aladin"
  | "naver_book"
  | "naver_blog"
  | "naver_news"
  | "web"
  | "user_upload" // 촬영본 OCR(원본 파일 미저장·텍스트만)
  | "user_manual"; // 교사 직접 입력

export type FactsheetEntry = {
  id: string;
  factsheet_id: string;
  owner_id: string;
  chapter_label: string;
  content: string;
  quote: string | null; // 원문 발췌 스니펫(user_manual은 null)
  source_url: string | null; // user_upload/user_manual이면 null
  source_type: FactsheetSourceType;
  content_hash: string;
  created_at: string;
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
          models?: string[];
          models_synced_at?: string | null;
        };
        Update: Partial<
          Pick<
            ApiKey,
            "encrypted_key" | "key_last4" | "models" | "models_synced_at"
          >
        >;
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
            | "needs_recalc"
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
          Pick<
            Student,
            | "name"
            | "student_number"
            | "teacher_memo"
            | "score_override"
            | "override_reason"
          >
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
          match_method?: MatchMethod | null;
          identity_source?: IdentitySource | null;
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
            | "student_id"
            | "match_status"
            | "match_method"
            | "identity_source"
            | "match_candidates"
            | "pending_content"
            | "storage_path"
            | "raw_student_no"
            | "raw_student_name"
            | "include_in_eval"
            | "include_in_record"
            | "extraction_approved_at"
            | "authenticity_status"
            | "authenticity"
            | "factsheet_id"
          >
        >;
        Relationships: [];
      };
      // evaluations·student_scores: insert/update는 RLS상 service role 전용(INV-6).
      evaluations: {
        Row: Evaluation;
        Insert: {
          submission_id: string;
          project_id: string;
          scores: EvaluationCriterionScore[];
          total_score: number;
          content_hash: string;
          raw_llm_output: string;
          model: string;
          is_current?: boolean;
        };
        Update: Partial<Pick<Evaluation, "is_current">>;
        Relationships: [];
      };
      student_scores: {
        Row: StudentScore;
        Insert: {
          project_id: string;
          student_id: string;
          composite_score: number;
          display_score: number | null;
          effective_score: number;
          rank: number;
          grade: number;
          calculated_at: string;
        };
        Update: Partial<
          Pick<
            StudentScore,
            | "composite_score"
            | "display_score"
            | "effective_score"
            | "rank"
            | "grade"
            | "calculated_at"
          >
        >;
        Relationships: [];
      };
      // records: generated 행 insert는 RLS상 service role 전용(INV-3). 교사 edited/manual은 소유자.
      records: {
        Row: StudentRecord;
        Insert: {
          project_id: string;
          student_id: string;
          version: number;
          content: string;
          sources: string[];
          origin: RecordOrigin;
          teacher_memo_used?: boolean;
          verification?: VerificationSentence[] | null;
          model?: string | null;
          is_current?: boolean;
        };
        // 버전 행은 불변 — 갱신은 새 버전 insert. is_current 관리만 update.
        Update: Partial<Pick<StudentRecord, "is_current">>;
        Relationships: [];
      };
      prompt_profiles: {
        Row: PromptProfile;
        Insert: {
          owner_id: string;
          project_id?: string | null;
          guidelines?: ProfileItem[];
          prohibitions?: ProfileItem[];
          version?: number;
        };
        Update: Partial<
          Pick<PromptProfile, "guidelines" | "prohibitions" | "version">
        >;
        Relationships: [];
      };
      // prompt_profile_versions: 프로필 이력 스냅샷(append-only). insert는 소유자 세션.
      prompt_profile_versions: {
        Row: PromptProfileVersion;
        Insert: {
          profile_id: string;
          owner_id: string;
          project_id?: string | null;
          version: number;
          guidelines: ProfileItem[];
          prohibitions: ProfileItem[];
          source: ProfileVersionSource;
        };
        Update: never;
        Relationships: [];
      };
      // ui_layouts: 결과 표 레이아웃(세션 8b). RLS는 user_id = auth.uid()만. 디바운스 upsert.
      ui_layouts: {
        Row: UiLayout;
        Insert: {
          user_id: string;
          project_id: string;
          layout: StoredLayout;
          updated_at?: string;
        };
        Update: Partial<{ layout: StoredLayout; updated_at: string }>;
        Relationships: [];
      };
      // factsheets (0013, 배치 8). RLS: owner/shared/admin. shared 전이는 admin만(with check).
      factsheets: {
        Row: Factsheet;
        Insert: {
          owner_id: string;
          title: string;
          isbn13?: string | null;
          author?: string | null;
          publisher?: string | null;
          pub_year?: string | null;
          toc?: string | null;
          intro?: string | null;
          cover_url?: string | null;
          share_status?: ShareStatus;
          forked_from?: string | null;
        };
        Update: Partial<
          Pick<
            Factsheet,
            | "title"
            | "author"
            | "publisher"
            | "pub_year"
            | "toc"
            | "intro"
            | "cover_url"
            | "share_status"
            | "review"
            | "reviewed_by"
            | "reviewed_at"
          >
        >;
        Relationships: [];
      };
      // factsheet_entries (0013, 배치 8). RLS: can_read/can_edit_factsheet. unique(factsheet_id, content_hash).
      factsheet_entries: {
        Row: FactsheetEntry;
        Insert: {
          factsheet_id: string;
          owner_id: string;
          content: string;
          source_type: FactsheetSourceType;
          content_hash: string;
          chapter_label?: string;
          quote?: string | null;
          source_url?: string | null;
        };
        Update: Partial<
          Pick<FactsheetEntry, "chapter_label" | "content" | "content_hash" | "quote">
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
