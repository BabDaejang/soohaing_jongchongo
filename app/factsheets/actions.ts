"use server";

import { revalidatePath } from "next/cache";
import { requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { searchBooks, lookupBook, type BookCandidate } from "@/lib/factsheet/aladin";
import { callLLM, type ModelTarget } from "@/lib/llm";
import type { LLMContentPart } from "@/lib/llm";
import {
  isLikelyScan,
  normalizeText,
  parsePdfText,
  sha256Hex,
} from "@/lib/parsing";
import type { FactsheetSourceType } from "@/lib/supabase/types";

// 도서팩트시트 전용 페이지(/factsheets)의 서버 액션 (리팩토링 2 배치 8).
// 계정 단위(프로젝트 무관). 무할루시네이션 원칙: 메타(toc·intro)는 알라딘 원본 LLM 비경유 저장,
// 수동/촬영본 entry는 교사가 직접 확인·입력한 텍스트만 저장한다(자동 웹 수집은 배치 9).

const OCR_TEXT_MAX = 20000;
const OCR_FILE_MAX_BYTES = 6 * 1024 * 1024; // base64 팽창 감안(next serverActions bodySizeLimit 10mb)
const OCR_PROMPT =
  "다음 이미지/문서에서 보이는 모든 텍스트를 원문 그대로 정확히 추출하라. " +
  "설명·해석·요약·머리말 없이, 추출된 텍스트만 반환하라. 표는 행/열 순서대로 텍스트로 옮겨라.";

// 중복 entry(unique factsheet_id, content_hash) 위반을 친절한 메시지로 바꾼다.
function dedupMessage(raw: string): string {
  return /duplicate key|content_hash/.test(raw)
    ? "같은 내용의 항목이 이미 있습니다."
    : raw;
}

// ── 도서 검색·생성 ────────────────────────────────────────────────────

// 검색 키(ALADIN)가 없으면 searchBooks가 throw — 결과 대신 에러 문자열로 강등한다(Next 에러 페이지 회피).
export async function searchBooksAction(
  query: string,
): Promise<{ ok: boolean; results: BookCandidate[]; error?: string }> {
  await requireApproved();
  try {
    return { ok: true, results: await searchBooks(query) };
  } catch (e) {
    return {
      ok: false,
      results: [],
      error: (e instanceof Error ? e.message : "검색에 실패했습니다.").slice(0, 300),
    };
  }
}

// 후보 도서 → 팩트시트 생성(메타·목차·소개만, entry는 만들지 않는다 — 자동 수집은 배치 9).
// 내 소유 동일 isbn13이 이미 있으면 생성하지 않고 그 id를 돌려준다(호출부가 상세로 이동).
export async function createFactsheetFromBook(
  isbn13: string,
): Promise<{ id: string }> {
  const { userId } = await requireApproved();
  const supabase = await createClient();
  const id = isbn13.trim();

  const { data: existing } = await supabase
    .from("factsheets")
    .select("id")
    .eq("owner_id", userId)
    .eq("isbn13", id)
    .maybeSingle();
  if (existing) return { id: existing.id };

  const detail = await lookupBook(id); // 키 없음·형식 오류는 throw
  if (!detail) throw new Error("도서 정보를 찾지 못했습니다.");

  const { data, error } = await supabase
    .from("factsheets")
    .insert({
      owner_id: userId,
      isbn13: detail.isbn13 ?? id,
      title: detail.title,
      author: detail.author,
      publisher: detail.publisher,
      pub_year: detail.pubYear,
      toc: detail.toc,
      intro: detail.intro,
      cover_url: detail.coverUrl,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/factsheets");
  return { id: data.id };
}

// ── 메타 편집 ─────────────────────────────────────────────────────────

export async function updateFactsheetMeta(
  id: string,
  meta: {
    title: string;
    author: string;
    publisher: string;
    pubYear: string;
    toc: string;
    intro: string;
  },
): Promise<void> {
  await requireApproved();
  const supabase = await createClient();
  const title = meta.title.trim();
  if (!title) throw new Error("제목은 비울 수 없습니다.");
  const trimOrNull = (s: string) => (s.trim() ? s.trim() : null);
  const { error } = await supabase
    .from("factsheets")
    .update({
      title,
      author: trimOrNull(meta.author),
      publisher: trimOrNull(meta.publisher),
      pub_year: trimOrNull(meta.pubYear),
      toc: trimOrNull(meta.toc),
      intro: trimOrNull(meta.intro),
    })
    .eq("id", id); // RLS: 소유자 and share_status<>shared만 통과
  if (error) throw new Error(error.message);
  revalidatePath(`/factsheets/${id}`);
}

// ── entry 편집(수동·촬영본) ───────────────────────────────────────────

// 직접 입력(user_manual) 또는 촬영본 OCR 확인분(user_upload)을 entry로 추가한다.
// quote·source_url은 null(수집 원문 대조 경로가 아님 — 교사 확인 입력). content_hash는 서버 산출.
export async function addManualEntry(
  factsheetId: string,
  chapterLabel: string,
  content: string,
  sourceType: "user_manual" | "user_upload" = "user_manual",
): Promise<void> {
  const { userId } = await requireApproved();
  const st: FactsheetSourceType =
    sourceType === "user_upload" ? "user_upload" : "user_manual";
  const supabase = await createClient();
  const text = content.trim();
  if (!text) throw new Error("내용을 입력하세요.");
  const { error } = await supabase.from("factsheet_entries").insert({
    factsheet_id: factsheetId,
    owner_id: userId,
    chapter_label: chapterLabel.trim() || "전체",
    content: text,
    quote: null,
    source_url: null,
    source_type: st,
    content_hash: sha256Hex(normalizeText(text)),
  }); // RLS: can_edit_factsheet(소유자·비shared·승인)
  if (error) throw new Error(dedupMessage(error.message));
  revalidatePath(`/factsheets/${factsheetId}`);
}

export async function updateEntry(
  entryId: string,
  factsheetId: string,
  chapterLabel: string,
  content: string,
): Promise<void> {
  await requireApproved();
  const supabase = await createClient();
  const text = content.trim();
  if (!text) throw new Error("내용을 입력하세요.");
  const { error } = await supabase
    .from("factsheet_entries")
    .update({
      chapter_label: chapterLabel.trim() || "전체",
      content: text,
      content_hash: sha256Hex(normalizeText(text)),
    })
    .eq("id", entryId); // RLS: can_edit_factsheet
  if (error) throw new Error(dedupMessage(error.message));
  revalidatePath(`/factsheets/${factsheetId}`);
}

export async function deleteEntry(
  entryId: string,
  factsheetId: string,
): Promise<void> {
  await requireApproved();
  const supabase = await createClient();
  const { error } = await supabase
    .from("factsheet_entries")
    .delete()
    .eq("id", entryId); // RLS: can_edit_factsheet
  if (error) throw new Error(error.message);
  revalidatePath(`/factsheets/${factsheetId}`);
}

// ── 공유 신청·복제 ────────────────────────────────────────────────────

// private/rejected → pending_review. RLS with check가 shared·rejected 자가 전이를 차단한다.
export async function requestShare(id: string): Promise<void> {
  await requireApproved();
  const supabase = await createClient();
  const { error } = await supabase
    .from("factsheets")
    .update({ share_status: "pending_review" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/factsheets/${id}`);
}

export async function cancelShareRequest(id: string): Promise<void> {
  await requireApproved();
  const supabase = await createClient();
  const { error } = await supabase
    .from("factsheets")
    .update({ share_status: "private" })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/factsheets/${id}`);
}

// shared 팩트시트를 내 계정으로 복제(메타+entries, share_status private, forked_from 기록).
// 이미 내 소유 동일 isbn13이면 그 id를 돌려준다(중복 생성 방지).
export async function forkFactsheet(id: string): Promise<{ id: string }> {
  const { userId } = await requireApproved();
  const supabase = await createClient();

  const { data: src, error: srcErr } = await supabase
    .from("factsheets")
    .select("*")
    .eq("id", id)
    .maybeSingle(); // RLS: shared면 can_read
  if (srcErr) throw new Error(srcErr.message);
  if (!src) throw new Error("팩트시트를 찾을 수 없습니다.");

  if (src.isbn13) {
    const { data: mine } = await supabase
      .from("factsheets")
      .select("id")
      .eq("owner_id", userId)
      .eq("isbn13", src.isbn13)
      .maybeSingle();
    if (mine) return { id: mine.id };
  }

  const { data: created, error } = await supabase
    .from("factsheets")
    .insert({
      owner_id: userId,
      isbn13: src.isbn13,
      title: src.title,
      author: src.author,
      publisher: src.publisher,
      pub_year: src.pub_year,
      toc: src.toc,
      intro: src.intro,
      cover_url: src.cover_url,
      forked_from: src.id, // share_status는 default 'private'
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: entries } = await supabase
    .from("factsheet_entries")
    .select("chapter_label, content, quote, source_url, source_type, content_hash")
    .eq("factsheet_id", id);
  if (entries && entries.length > 0) {
    const { error: entErr } = await supabase.from("factsheet_entries").insert(
      entries.map((e) => ({
        factsheet_id: created.id,
        owner_id: userId,
        chapter_label: e.chapter_label,
        content: e.content,
        quote: e.quote,
        source_url: e.source_url,
        source_type: e.source_type,
        content_hash: e.content_hash,
      })),
    );
    if (entErr) throw new Error(entErr.message);
  }
  revalidatePath("/factsheets");
  return { id: created.id };
}

// ── 촬영본 OCR 추출(원본 파일 미저장 — 텍스트만 미리보기 반환) ─────────

function imageMediaType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

async function ocrCall(
  userId: string,
  target: ModelTarget,
  part: LLMContentPart,
): Promise<string> {
  const res = await callLLM({
    userId,
    purpose: "추출",
    overrideTarget: target, // 프로젝트 라우팅 밖 — 사용자가 고른 추출 모델
    temperature: 0,
    messages: [{ role: "user", content: [part, { type: "text", text: OCR_PROMPT }] }],
  });
  return res.text;
}

// 이미지·스캔 PDF는 비전 OCR, 텍스트 레이어 PDF는 추출만(LLM 비경유). 원본은 저장하지 않는다.
async function extractPhotoText(
  userId: string,
  filename: string,
  bytes: Uint8Array,
  target: ModelTarget,
): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") {
    const { text: layer, pages } = await parsePdfText(bytes); // 배치 1 detach 방어(사본)
    if (!isLikelyScan(layer, pages)) return layer;
    return ocrCall(userId, target, {
      type: "document",
      mediaType: "application/pdf",
      dataBase64: Buffer.from(bytes).toString("base64"),
      filename,
    });
  }
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return ocrCall(userId, target, {
      type: "image",
      mediaType: imageMediaType(filename),
      dataBase64: Buffer.from(bytes).toString("base64"),
    });
  }
  throw new Error("지원하지 않는 형식입니다(png·jpg·webp·pdf만 가능).");
}

// FormData(file·providerId·model) → 추출 텍스트. throw하지 않고 {ok,message}로 돌려준다.
export async function ocrExtractForFactsheet(
  formData: FormData,
): Promise<{ ok: boolean; text?: string; message?: string }> {
  const { userId } = await requireApproved();
  const file = formData.get("file");
  const providerId = String(formData.get("providerId") ?? "");
  const model = String(formData.get("model") ?? "").trim();
  if (!(file instanceof File)) return { ok: false, message: "파일이 없습니다." };
  if (!providerId || !model) return { ok: false, message: "OCR 모델을 선택하세요." };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return { ok: false, message: "빈 파일입니다." };
    if (bytes.length > OCR_FILE_MAX_BYTES) {
      return { ok: false, message: "파일이 너무 큽니다(6MB 이하)." };
    }
    const text = await extractPhotoText(userId, file.name, bytes, {
      provider_id: providerId,
      model,
    });
    const clean = text.trim();
    if (!clean) return { ok: false, message: "텍스트를 추출하지 못했습니다." };
    return { ok: true, text: clean.slice(0, OCR_TEXT_MAX) };
  } catch (e) {
    return {
      ok: false,
      message: (e instanceof Error ? e.message : "OCR 처리 중 오류").slice(0, 300),
    };
  }
}
