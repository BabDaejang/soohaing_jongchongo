import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ApiFormat } from "@/lib/supabase/types";

// 모델 라우팅 화면이 쓰는 "이 사용자가 실제로 호출할 수 있는 프로바이더" 목록 (SPEC 3절).
// 키 해석 규칙은 resolveApiKey와 같다: 개인 키 우선, 없으면 관리자 기본 키.
//
// 기본 키(owner_id NULL) 행은 api_keys RLS에서 admin만 select 할 수 있으므로
// 서비스 롤로 조회한다. encrypted_key는 select 하지 않는다 (INV-4).

export type KeySource = "personal" | "default";

export type RoutableProvider = {
  id: string;
  name: string;
  api_format: ApiFormat;
  /** 사용할 키에 저장된 모델 목록. 0010 이전에 등록된 키는 비어 있다. */
  models: string[];
  /** null이면 쓸 수 있는 키가 없어 라우팅 대상이 될 수 없다. */
  keySource: KeySource | null;
};

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

// 전 프로바이더를 반환한다(keySource로 사용 가능 여부를 표시). 화면이 숨김·비활성을 결정한다.
export async function listRoutableProviders(
  userId: string,
): Promise<RoutableProvider[]> {
  const admin = createAdminClient();

  const [providersRes, keysRes] = await Promise.all([
    admin.from("providers").select("id, name, api_format").order("name"),
    admin
      .from("api_keys")
      .select("provider_id, owner_id, models")
      .or(`owner_id.eq.${userId},owner_id.is.null`),
  ]);

  if (providersRes.error) {
    throw new Error(`프로바이더 조회 실패: ${providersRes.error.message}`);
  }
  if (keysRes.error) {
    throw new Error(`API 키 조회 실패: ${keysRes.error.message}`);
  }

  const keys = keysRes.data ?? [];

  return (providersRes.data ?? []).map((p) => {
    const forProvider = keys.filter((k) => k.provider_id === p.id);
    const personal = forProvider.find((k) => k.owner_id === userId);
    const fallback = forProvider.find((k) => k.owner_id === null);
    const chosen = personal ?? fallback;

    return {
      id: p.id,
      name: p.name,
      api_format: p.api_format,
      models: chosen ? toStringArray(chosen.models) : [],
      keySource: chosen ? (personal ? "personal" : "default") : null,
    };
  });
}
