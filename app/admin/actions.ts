"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { encrypt, keyLast4 } from "@/lib/crypto";
import { validateKeyAndListModels, refreshKeyModels } from "@/lib/llm/key-sync";
import {
  reviewEntryStrict,
  reviewMetaStrict,
  type EntryReview,
} from "@/lib/factsheet/strict-review";
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

// ── 팩트시트 공유 승인 · AI 엄격 검증 (리팩토링 2 배치 11) ──────────────
//
// 공유 모델(사용자 확정 2026-07-13): private → pending_review(교사 신청) → shared(관리자 승인).
// 승인 전 AI가 출처를 재수집해 발췌 실존·내용 뒷받침을 엄격 검증하고, 관리자가 리포트를 참고해
// 승인/반려한다(자동 승인·반려 없음 — 판정은 참고 자료). 팩트시트 update는 admin RLS로 통과한다.

// [AI 엄격 검증 실행]의 prepare — entry 목록을 대상으로 조립(LLM 없음).
const REVIEW_SOURCE_SHORT: Record<string, string> = {
  aladin: "알라딘",
  naver_book: "네이버 책",
  naver_blog: "블로그",
  naver_news: "뉴스",
  web: "웹",
  user_upload: "촬영본",
  user_manual: "직접 입력",
};

export async function prepareStrictReview(factsheetId: string): Promise<{
  targets: { id: string; label: string }[];
  prelude: { level: "system" | "info" | "error"; text: string }[];
}> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("factsheet_entries")
    .select("id, chapter_label, source_type")
    .eq("factsheet_id", factsheetId)
    .order("created_at", { ascending: true }); // RLS can_read_factsheet(admin 포함)
  if (error) {
    return { targets: [], prelude: [{ level: "error", text: error.message.slice(0, 300) }] };
  }
  const list = data ?? [];
  return {
    targets: list.map((e) => ({
      id: e.id,
      label: `${e.chapter_label} · ${REVIEW_SOURCE_SHORT[e.source_type] ?? e.source_type}`,
    })),
    prelude: [{ level: "system", text: `검증 대상 entry ${list.length}건` }],
  };
}

// entry 1건 엄격 검증. 반환은 EntryReview의 상위집합({ok,message} 추가 — 배치 9·10 선례).
export async function reviewEntryStrictAction(
  factsheetId: string,
  entryId: string,
  providerId: string,
  model: string,
): Promise<EntryReview & { ok: boolean; message: string }> {
  const { userId } = await requireAdmin();
  const fail = (note: string): EntryReview & { ok: boolean; message: string } => ({
    entryId,
    result: "unfetchable",
    note,
    ok: false,
    message: note,
  });
  if (!providerId || !model.trim()) return fail("검증 모델을 선택하세요(키 보유 프로바이더).");

  const supabase = await createClient();
  const { data: entry, error } = await supabase
    .from("factsheet_entries")
    .select("id, chapter_label, content, quote, source_url, factsheet_id")
    .eq("id", entryId)
    .maybeSingle(); // RLS can_read_factsheet(admin 포함)
  if (error) return fail(error.message.slice(0, 300));
  if (!entry || entry.factsheet_id !== factsheetId) return fail("항목을 찾을 수 없습니다.");

  const review = await reviewEntryStrict(
    entry,
    { provider_id: providerId, model: model.trim() },
    userId,
  );
  const label =
    review.result === "pass" ? "통과" : review.result === "fail" ? "실패" : "재확인 불가";
  return {
    ...review,
    ok: review.result === "pass",
    message: `${label} — ${review.note}`,
  };
}

// finalize — 메타 재확인 + review jsonb 저장 + audit. reviewed_by/at은 승인·반려 시 기록한다.
export async function finalizeStrictReview(
  factsheetId: string,
  reviews: EntryReview[],
  model: string,
): Promise<string> {
  const { userId } = await requireAdmin();
  const supabase = await createClient();

  const { data: fs } = await supabase
    .from("factsheets")
    .select("isbn13, title, author")
    .eq("id", factsheetId)
    .maybeSingle();
  const metaCheck = fs
    ? await reviewMetaStrict(fs)
    : { status: "skipped" as const, note: "팩트시트를 찾을 수 없습니다." };

  const summary = {
    pass: reviews.filter((r) => r.result === "pass").length,
    fail: reviews.filter((r) => r.result === "fail").length,
    unfetchable: reviews.filter((r) => r.result === "unfetchable").length,
  };
  const report = {
    summary,
    entries: reviews,
    metaCheck,
    model,
    reviewed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("factsheets")
    .update({ review: report })
    .eq("id", factsheetId); // admin RLS
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId: userId,
    action: "factsheet.strict_review",
    entity: "factsheets",
    entityId: factsheetId,
    detail: { ...summary, meta: metaCheck.status },
  });
  revalidatePath("/admin");
  return `엄격 검증 완료 — 통과 ${summary.pass}·실패 ${summary.fail}·재확인 불가 ${summary.unfetchable} / 메타 ${
    metaCheck.status === "ok" ? "일치" : metaCheck.status === "warn" ? "경고" : "생략"
  }`;
}

// [승인] — 전 계정 읽기 전용 공유. fail 건이 있어도 관리자 판단으로 승인 가능(클라이언트가 경고 확인).
export async function approveFactsheet(id: string): Promise<void> {
  const { userId } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("factsheets")
    .update({
      share_status: "shared",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id); // admin RLS
  if (error) throw new Error(error.message);
  await writeAuditLog({
    actorId: userId,
    action: "factsheet.approve",
    entity: "factsheets",
    entityId: id,
  });
  revalidatePath("/admin");
  revalidatePath("/factsheets");
}

// [반려] — 사유 필수. review에 반려 사유를 병기하고 rejected로 전이(교사가 사유 확인 후 재신청).
export async function rejectFactsheet(id: string, reason: string): Promise<void> {
  const { userId } = await requireAdmin();
  const r = reason.trim();
  if (!r) throw new Error("반려 사유를 입력하세요.");
  const supabase = await createClient();

  const { data: fs } = await supabase
    .from("factsheets")
    .select("review")
    .eq("id", id)
    .maybeSingle();
  const prev =
    fs?.review && typeof fs.review === "object" && !Array.isArray(fs.review)
      ? (fs.review as Record<string, unknown>)
      : {};
  const review = { ...prev, rejected_reason: r, rejected_at: new Date().toISOString() };

  const { error } = await supabase
    .from("factsheets")
    .update({
      share_status: "rejected",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review,
    })
    .eq("id", id); // admin RLS
  if (error) throw new Error(error.message);
  await writeAuditLog({
    actorId: userId,
    action: "factsheet.reject",
    entity: "factsheets",
    entityId: id,
    detail: { reason: r.slice(0, 200) },
  });
  revalidatePath("/admin");
  revalidatePath("/factsheets");
}

// [공유 철회] — shared → private(전 계정 접근 회수, 소유 교사가 다시 편집·재신청 가능).
export async function unshareFactsheet(id: string): Promise<void> {
  const { userId } = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("factsheets")
    .update({ share_status: "private" })
    .eq("id", id); // admin RLS
  if (error) throw new Error(error.message);
  await writeAuditLog({
    actorId: userId,
    action: "factsheet.unshare",
    entity: "factsheets",
    entityId: id,
  });
  revalidatePath("/admin");
  revalidatePath("/factsheets");
}
