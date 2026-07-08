// DB 행 타입 수동 정의 (docs/DATA_MODEL.md 1·2절).
// 스키마가 커지면 supabase gen types 도입을 검토한다 (세션 3 이후).
// 주의: postgrest-js의 Record<string, unknown> 제약(암시적 인덱스 시그니처) 때문에
// interface가 아닌 type 별칭으로 선언해야 한다.

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
