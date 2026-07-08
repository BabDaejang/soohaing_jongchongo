import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";

// API 키 해석 (SPEC 3절 / DATA_MODEL 4절):
//   개인 키(owner_id = userId) 존재 → 개인 키, 없으면 기본 키(owner_id NULL), 둘 다 없으면 에러.
//
// 기본 키(owner_id NULL)는 api_keys RLS에서 admin만 select 가능하므로, 일반 사용자를 위해
// 서비스 롤(admin 클라이언트)로 조회한다. 복호화도 서버 전용(INV-4).

export type ApiKeyRow = {
  owner_id: string | null;
  encrypted_key: string;
};

// (provider_id, userId)에 해당하는 후보 키 행들을 가져온다. 테스트에서 주입 가능.
export type ApiKeyFetcher = (
  providerId: string,
  userId: string,
) => Promise<ApiKeyRow[]>;

// 서비스 롤로 개인 키 + 기본 키 후보를 조회하는 기본 페처.
const defaultFetchRows: ApiKeyFetcher = async (providerId, userId) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("owner_id, encrypted_key")
    .eq("provider_id", providerId)
    .or(`owner_id.eq.${userId},owner_id.is.null`);
  if (error) {
    throw new Error(`API 키 조회 실패: ${error.message}`);
  }
  return data ?? [];
};

// 개인 키 우선, 없으면 기본 키. 복호화한 평문을 반환한다.
// decrypt·fetchRows는 단위 테스트를 위해 주입 가능(기본값은 실제 구현).
export async function resolveApiKey(
  userId: string,
  providerId: string,
  deps?: { fetchRows?: ApiKeyFetcher; decryptFn?: (payload: string) => string },
): Promise<string> {
  const fetchRows = deps?.fetchRows ?? defaultFetchRows;
  const decryptFn = deps?.decryptFn ?? decrypt;

  const rows = await fetchRows(providerId, userId);
  const personal = rows.find((r) => r.owner_id === userId);
  const fallback = rows.find((r) => r.owner_id === null);
  const chosen = personal ?? fallback;

  if (!chosen) {
    throw new Error(
      "등록된 API 키가 없습니다. 관리자 기본 키 또는 개인 키를 먼저 등록하세요.",
    );
  }
  return decryptFn(chosen.encrypted_key);
}
