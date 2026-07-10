import "server-only";
import type { ApiFormat } from "@/lib/supabase/types";
import { DEFAULT_BASE_URLS } from "./types";

// 프로바이더 API에서 "이 키로 쓸 수 있는 모델 ID 목록"을 조회한다 (SPEC 3절).
// 키 등록 시 유효성 검증을 겸하고, [모델 갱신]으로 재조회한다.
// 서버 전용 — apiKey 평문을 다루므로 클라이언트 번들에 유입되면 INV-4 위반.
//
// api_format별 엔드포인트는 어댑터(adapters/*.ts)의 baseUrl 규약을 그대로 따른다:
//   anthropic: {baseUrl}/v1/models            (x-api-key)
//   openai:    {baseUrl}/models               (Authorization: Bearer)
//   google:    {baseUrl}/v1beta/models?key=…  (쿼리 파라미터)

const TIMEOUT_MS = 15_000;
const MAX_PAGES = 5; // 페이지네이션 폭주 방지

// ── 순수 함수 (단위 테스트 대상) ──────────────────────────────────────

// OpenAI의 /models는 임베딩·음성·이미지 모델까지 전부 반환하고 능력 메타데이터가 없다.
// 어댑터가 쓰는 chat completions로 호출 가능한 모델만 남기는 휴리스틱 —
// 실제 응답(120개)으로 검증했고, 걸러지지 않은 모델은 직접 입력으로 폴백한다.
const OPENAI_CHAT_PREFIXES = ["gpt-", "chatgpt-", "o1", "o3", "o4"];
const OPENAI_EXCLUDE_PARTS = [
  "-audio",
  "-realtime",
  "-transcribe",
  "-tts",
  "-instruct", // legacy completions 전용
  "-codex", // responses API 전용
  "-search-api", // responses API 전용
  "gpt-image",
];

export function isOpenAIChatModel(id: string): boolean {
  if (!OPENAI_CHAT_PREFIXES.some((p) => id.startsWith(p))) return false;
  return !OPENAI_EXCLUDE_PARTS.some((part) => id.includes(part));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(row: unknown, field: string): string | null {
  const rec = asRecord(row);
  const v = rec?.[field];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// { data: [{ id }], has_more, last_id }
export function parseAnthropicModels(json: unknown): string[] {
  const data = asRecord(json)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => stringField(row, "id") ?? []);
}

// { data: [{ id }] } — 채팅 가능 모델만 남긴다.
export function parseOpenAIModels(json: unknown): string[] {
  const data = asRecord(json)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const id = stringField(row, "id");
    return id && isOpenAIChatModel(id) ? id : [];
  });
}

// { models: [{ name: "models/gemini-…", supportedGenerationMethods: [...] }] }
// generateContent를 지원하는 모델만, "models/" 접두사를 떼어 반환한다.
export function parseGoogleModels(json: unknown): string[] {
  const models = asRecord(json)?.models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((row) => {
    const methods = asRecord(row)?.supportedGenerationMethods;
    const supported =
      Array.isArray(methods) && methods.includes("generateContent");
    const name = stringField(row, "name");
    if (!supported || !name) return [];
    return name.startsWith("models/") ? name.slice("models/".length) : name;
  });
}

// 중복 제거 + 사전순. 화면 표시 순서를 결정적으로 만든다.
export function normalizeModelIds(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

// ── 조회 ──────────────────────────────────────────────────────────────

// 에러 본문에 키가 섞여 나올 여지를 차단하고 길이를 제한한다 (INV-4).
function safeErrorBody(body: string, apiKey: string): string {
  return body.split(apiKey).join("***").trim().slice(0, 300);
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  apiKey: string,
  providerLabel: string,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // url에는 google의 key 쿼리가 들어 있으므로 메시지에 절대 넣지 않는다.
    throw new Error(`${providerLabel} 모델 목록 조회에 실패했습니다 (네트워크 오류·시간 초과).`);
  }
  if (!res.ok) {
    const detail = safeErrorBody(await res.text(), apiKey);
    throw new Error(
      `${providerLabel} 모델 목록 조회 실패 (HTTP ${res.status}). 키가 유효한지 확인하세요. ${detail}`,
    );
  }
  return res.json();
}

async function listAnthropic(baseUrl: string, apiKey: string): Promise<string[]> {
  const headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  const ids: string[] = [];
  let afterId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${baseUrl}/v1/models`);
    url.searchParams.set("limit", "1000");
    if (afterId) url.searchParams.set("after_id", afterId);

    const json = await fetchJson(url.toString(), headers, apiKey, "anthropic");
    ids.push(...parseAnthropicModels(json));

    const rec = asRecord(json);
    if (rec?.has_more !== true) break;
    afterId = typeof rec.last_id === "string" ? rec.last_id : null;
    if (!afterId) break;
  }
  return ids;
}

async function listOpenAI(baseUrl: string, apiKey: string): Promise<string[]> {
  const json = await fetchJson(
    `${baseUrl}/models`,
    { authorization: `Bearer ${apiKey}` },
    apiKey,
    "openai 호환",
  );
  return parseOpenAIModels(json);
}

async function listGoogle(baseUrl: string, apiKey: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${baseUrl}/v1beta/models`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const json = await fetchJson(url.toString(), {}, apiKey, "google");
    ids.push(...parseGoogleModels(json));

    const next = asRecord(json)?.nextPageToken;
    pageToken = typeof next === "string" && next.length > 0 ? next : null;
    if (!pageToken) break;
  }
  return ids;
}

// 키가 유효하면 모델 ID 목록을, 아니면 throw. 빈 목록도 "유효하지 않음"으로 본다
// (권한이 있는 키라면 최소 1개는 반환되기 때문).
export async function listProviderModels(
  apiFormat: ApiFormat,
  baseUrl: string | null,
  apiKey: string,
): Promise<string[]> {
  const base = (baseUrl ?? DEFAULT_BASE_URLS[apiFormat]).replace(/\/+$/, "");

  const raw =
    apiFormat === "anthropic"
      ? await listAnthropic(base, apiKey)
      : apiFormat === "openai"
        ? await listOpenAI(base, apiKey)
        : await listGoogle(base, apiKey);

  const models = normalizeModelIds(raw);
  if (models.length === 0) {
    throw new Error(
      "모델 목록이 비어 있습니다. 키에 모델 접근 권한이 있는지 확인하세요.",
    );
  }
  return models;
}
