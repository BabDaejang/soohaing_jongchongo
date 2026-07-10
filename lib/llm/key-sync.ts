import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto";
import { listProviderModels } from "./models";

// 키 등록 검증과 모델 목록 갱신 (SPEC 3절). 개인 키(owner_id = userId)와
// 기본 키(owner_id = null)가 같은 로직을 쓰므로 여기 모아 둔다.
// 평문 키를 다루는 서버 전용 모듈 — 반환값에 평문을 포함하지 않는다 (INV-4).

async function fetchProviderConfig(providerId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("providers")
    .select("api_format, base_url")
    .eq("id", providerId)
    .maybeSingle();

  if (error) throw new Error(`프로바이더 조회 실패: ${error.message}`);
  if (!data) throw new Error("프로바이더를 찾을 수 없습니다.");
  return data;
}

// 키가 유효한지 확인하고 모델 목록을 돌려준다. 무효하면 throw (호출부가 저장을 중단한다).
export async function validateKeyAndListModels(
  providerId: string,
  rawKey: string,
): Promise<string[]> {
  const { api_format, base_url } = await fetchProviderConfig(providerId);
  return listProviderModels(api_format, base_url, rawKey);
}

// 저장된 키를 복호화해 모델 목록을 재조회하고 행을 갱신한다. 갱신된 목록을 반환한다.
// ownerId = null 이면 관리자 기본 키. 호출부가 권한(requireApproved/requireAdmin)을 이미 강제한다.
export async function refreshKeyModels(
  providerId: string,
  ownerId: string | null,
): Promise<string[]> {
  const admin = createAdminClient();

  const query = admin
    .from("api_keys")
    .select("id, encrypted_key")
    .eq("provider_id", providerId);

  const { data: row, error } = await (
    ownerId === null ? query.is("owner_id", null) : query.eq("owner_id", ownerId)
  ).maybeSingle();

  if (error) throw new Error(`API 키 조회 실패: ${error.message}`);
  if (!row) throw new Error("등록된 키가 없습니다.");

  const models = await validateKeyAndListModels(providerId, decrypt(row.encrypted_key));

  const { error: updateError } = await admin
    .from("api_keys")
    .update({ models, models_synced_at: new Date().toISOString() })
    .eq("id", row.id);
  if (updateError) throw new Error(`모델 목록 저장 실패: ${updateError.message}`);

  return models;
}
