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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
