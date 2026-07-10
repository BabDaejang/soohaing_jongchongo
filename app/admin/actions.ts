"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { encrypt, keyLast4 } from "@/lib/crypto";
import { validateKeyAndListModels, refreshKeyModels } from "@/lib/llm/key-sync";
import type { ApiFormat } from "@/lib/supabase/types";

// ── 계정 승인/거부/삭제 ──────────────────────────────────────────────

async function setStatus(
  userId: string,
  status: "approved" | "rejected",
  action: "profile.approve" | "profile.reject",
) {
  const { userId: actorId } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  await writeAuditLog({ actorId, action, entity: "profiles", entityId: userId });
  revalidatePath("/admin");
}

export async function approveUser(formData: FormData) {
  const userId = String(formData.get("userId"));
  await setStatus(userId, "approved", "profile.approve");
}

export async function rejectUser(formData: FormData) {
  const userId = String(formData.get("userId"));
  await setStatus(userId, "rejected", "profile.reject");
}

export async function deleteUser(formData: FormData) {
  const { userId: actorId } = await requireAdmin();
  const userId = String(formData.get("userId"));

  // 계정 삭제 = auth.users 삭제(→ profiles cascade). service role 필요.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId,
    action: "profile.delete",
    entity: "profiles",
    entityId: userId,
  });
  revalidatePath("/admin");
}

// ── 대기 화면 안내문 ──────────────────────────────────────────────────

export async function updateWaitingMessage(formData: FormData) {
  const { userId: actorId } = await requireAdmin();
  const message = String(formData.get("message") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: "waiting_message", value: message, updated_by: actorId },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId,
    action: "app_settings.update",
    entity: "app_settings",
    detail: { key: "waiting_message" },
  });
  revalidatePath("/admin");
  revalidatePath("/waiting");
}

// ── 프로바이더 추가 ───────────────────────────────────────────────────

export async function addProvider(formData: FormData) {
  const { userId: actorId } = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const apiFormat = String(formData.get("api_format") ?? "") as ApiFormat;
  const baseUrlRaw = String(formData.get("base_url") ?? "").trim();

  if (!name) throw new Error("프로바이더 이름을 입력하세요.");
  if (!["anthropic", "openai", "google"].includes(apiFormat)) {
    throw new Error("API 형식이 올바르지 않습니다.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("providers")
    .insert({
      name,
      api_format: apiFormat,
      base_url: baseUrlRaw || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId,
    action: "provider.add",
    entity: "providers",
    entityId: data.id,
    detail: { name, api_format: apiFormat },
  });
  revalidatePath("/admin");
}

// ── 기본 API 키 등록/변경/삭제 (owner_id NULL) ────────────────────────

// 등록·갱신은 프로바이더 API 호출을 동반하므로 실패가 정상 경로다 (SPEC 3절 키 검증).
export type KeyActionState = { ok: boolean; message: string } | null;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}

export async function setDefaultKey(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const { userId: actorId } = await requireAdmin();
  const providerId = String(formData.get("providerId"));
  const rawKey = String(formData.get("apiKey") ?? "").trim();
  if (!rawKey) return { ok: false, message: "API 키를 입력하세요." };

  // 저장 전에 모델 목록을 조회해 키 유효성을 검증하고, 그 목록을 함께 저장한다.
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

  // 기본 키는 프로바이더별 1행(owner_id NULL). 존재하면 갱신, 없으면 삽입.
  const { data: existing, error: selectError } = await supabase
    .from("api_keys")
    .select("id")
    .eq("provider_id", providerId)
    .is("owner_id", null)
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
      owner_id: null,
      encrypted_key,
      key_last4,
      models,
      models_synced_at,
    });
    if (error) return { ok: false, message: error.message };
  }

  await writeAuditLog({
    actorId,
    action: "api_key.set",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "default", last4: key_last4, models: models.length }, // 평문 금지 — 끝 4자리만
  });
  revalidatePath("/admin");
  return { ok: true, message: `키를 확인했습니다. 모델 ${models.length}개를 불러왔습니다.` };
}

export async function refreshDefaultKeyModels(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const { userId: actorId } = await requireAdmin();
  const providerId = String(formData.get("providerId"));

  let models: string[];
  try {
    models = await refreshKeyModels(providerId, null);
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }

  await writeAuditLog({
    actorId,
    action: "api_key.models_refresh",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "default", models: models.length },
  });
  revalidatePath("/admin");
  return { ok: true, message: `모델 ${models.length}개로 갱신했습니다.` };
}

export async function deleteDefaultKey(formData: FormData) {
  const { userId: actorId } = await requireAdmin();
  const providerId = String(formData.get("providerId"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("provider_id", providerId)
    .is("owner_id", null);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId,
    action: "api_key.delete",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "default" },
  });
  revalidatePath("/admin");
}
