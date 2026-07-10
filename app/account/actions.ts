"use server";

import { revalidatePath } from "next/cache";
import { requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { encrypt, keyLast4 } from "@/lib/crypto";
import { validateKeyAndListModels, refreshKeyModels } from "@/lib/llm/key-sync";

// 키 등록·갱신은 프로바이더 API 호출을 동반하므로 실패가 정상 경로다.
// throw 대신 결과를 돌려주어 화면에 인라인 표시한다 (useActionState).
export type KeyActionState = { ok: boolean; message: string } | null;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}

// 개인 API 키 등록/변경 (SPEC 3절). owner_id = 본인. RLS가 본인 행만 CRUD 허용.
// 저장 전에 프로바이더 모델 목록을 조회해 키 유효성을 검증하고, 그 목록을 함께 저장한다.
export async function setPersonalKey(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const { userId } = await requireApproved();
  const providerId = String(formData.get("providerId"));
  const rawKey = String(formData.get("apiKey") ?? "").trim();
  if (!rawKey) return { ok: false, message: "API 키를 입력하세요." };

  let models: string[];
  try {
    models = await validateKeyAndListModels(providerId, rawKey);
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }

  const supabase = await createClient();
  const encrypted_key = encrypt(rawKey);
  const key_last4 = keyLast4(rawKey);
  const models_synced_at = new Date().toISOString();

  // 사용자당 프로바이더별 1행. 존재하면 갱신, 없으면 삽입.
  const { data: existing, error: selectError } = await supabase
    .from("api_keys")
    .select("id")
    .eq("provider_id", providerId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (selectError) return { ok: false, message: selectError.message };

  if (existing) {
    const { error } = await supabase
      .from("api_keys")
      .update({ encrypted_key, key_last4, models, models_synced_at })
      .eq("id", existing.id);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("api_keys").insert({
      provider_id: providerId,
      owner_id: userId,
      encrypted_key,
      key_last4,
      models,
      models_synced_at,
    });
    if (error) return { ok: false, message: error.message };
  }

  await writeAuditLog({
    actorId: userId,
    action: "api_key.set",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "personal", last4: key_last4, models: models.length }, // 평문 금지
  });
  revalidatePath("/account");
  return { ok: true, message: `키를 확인했습니다. 모델 ${models.length}개를 불러왔습니다.` };
}

// 모델 목록만 재조회한다 (프로바이더가 모델을 추가·폐기했을 때).
export async function refreshPersonalKeyModels(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const { userId } = await requireApproved();
  const providerId = String(formData.get("providerId"));

  let models: string[];
  try {
    models = await refreshKeyModels(providerId, userId);
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }

  await writeAuditLog({
    actorId: userId,
    action: "api_key.models_refresh",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "personal", models: models.length },
  });
  revalidatePath("/account");
  return { ok: true, message: `모델 ${models.length}개로 갱신했습니다.` };
}

export async function deletePersonalKey(formData: FormData) {
  const { userId } = await requireApproved();
  const providerId = String(formData.get("providerId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("provider_id", providerId)
    .eq("owner_id", userId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId: userId,
    action: "api_key.delete",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "personal" },
  });
  revalidatePath("/account");
}
