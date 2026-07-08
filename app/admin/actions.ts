"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { encrypt, keyLast4 } from "@/lib/crypto";
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

export async function setDefaultKey(formData: FormData) {
  const { userId: actorId } = await requireAdmin();
  const providerId = String(formData.get("providerId"));
  const rawKey = String(formData.get("apiKey") ?? "").trim();
  if (!rawKey) throw new Error("API 키를 입력하세요.");

  const supabase = await createClient();
  const encrypted_key = encrypt(rawKey);
  const key_last4 = keyLast4(rawKey);

  // 기본 키는 프로바이더별 1행(owner_id NULL). 존재하면 갱신, 없으면 삽입.
  const { data: existing } = await supabase
    .from("api_keys")
    .select("id")
    .eq("provider_id", providerId)
    .is("owner_id", null)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("api_keys")
      .update({ encrypted_key, key_last4 })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("api_keys")
      .insert({ provider_id: providerId, owner_id: null, encrypted_key, key_last4 });
    if (error) throw new Error(error.message);
  }

  await writeAuditLog({
    actorId,
    action: "api_key.set",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "default", last4: key_last4 }, // 평문 금지 — 끝 4자리만
  });
  revalidatePath("/admin");
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
