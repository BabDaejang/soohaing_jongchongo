"use server";

import { revalidatePath } from "next/cache";
import { requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";
import { encrypt, keyLast4 } from "@/lib/crypto";

// 개인 API 키 등록/변경 (SPEC 3절). owner_id = 본인. RLS가 본인 행만 CRUD 허용.
export async function setPersonalKey(formData: FormData) {
  const { userId } = await requireApproved();
  const providerId = String(formData.get("providerId"));
  const rawKey = String(formData.get("apiKey") ?? "").trim();
  if (!rawKey) throw new Error("API 키를 입력하세요.");

  const supabase = await createClient();
  const encrypted_key = encrypt(rawKey);
  const key_last4 = keyLast4(rawKey);

  // 사용자당 프로바이더별 1행. 존재하면 갱신, 없으면 삽입.
  const { data: existing } = await supabase
    .from("api_keys")
    .select("id")
    .eq("provider_id", providerId)
    .eq("owner_id", userId)
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
      .insert({ provider_id: providerId, owner_id: userId, encrypted_key, key_last4 });
    if (error) throw new Error(error.message);
  }

  await writeAuditLog({
    actorId: userId,
    action: "api_key.set",
    entity: "api_keys",
    entityId: providerId,
    detail: { scope: "personal", last4: key_last4 }, // 평문 금지
  });
  revalidatePath("/account");
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
