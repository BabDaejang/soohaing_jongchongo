"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireProjectOwner } from "@/lib/projects";
import { callLLM, type ModelRouting, type ModelTarget } from "@/lib/llm";
import { extractTextFromExampleFile } from "@/lib/records/example-file";
import { buildRubricPlanMessages } from "@/lib/prompts/rubric-plan";
import type { RubricCriterion } from "@/lib/supabase/types";

// 클라이언트가 보낸 criteria(JSON)를 검증해 정규화한다. 형식 오류는 명시적 에러.
function validateCriteria(input: unknown): RubricCriterion[] {
  if (!Array.isArray(input)) {
    throw new Error("루브릭 기준은 배열이어야 합니다.");
  }
  if (input.length === 0) {
    throw new Error("최소 1개의 평가 기준이 필요합니다.");
  }
  return input.map((item, idx): RubricCriterion => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`기준 ${idx + 1}의 형식이 올바르지 않습니다.`);
    }
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) throw new Error(`기준 ${idx + 1}의 이름을 입력하세요.`);
    const description =
      typeof rec.description === "string" ? rec.description.trim() : "";
    const max_score = Number(rec.max_score);
    if (!Number.isFinite(max_score) || max_score <= 0) {
      throw new Error(`기준 "${name}"의 배점은 0보다 커야 합니다.`);
    }
    const weight = Number(rec.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`기준 "${name}"의 가중치는 0 이상이어야 합니다.`);
    }
    const id = typeof rec.id === "string" && rec.id ? rec.id : randomUUID();
    return { id, name, description, max_score, weight };
  });
}

export async function saveRubric(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { supabase } = await requireProjectOwner(projectId);

  const raw = String(formData.get("criteria") ?? "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("루브릭 데이터 형식이 올바르지 않습니다.");
  }
  const criteria = validateCriteria(parsed);

  const { error } = await supabase
    .from("rubrics")
    .update({ criteria })
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}/rubric`);
  revalidatePath(`/projects/${projectId}`);
}

// ── 루브릭 전담 모델 저장 (routing.rubric — 폴백 rubric ?? default ?? evaluate) ──
export async function saveRubricModel(
  projectId: string,
  providerId: string,
  model: string,
): Promise<void> {
  const { supabase } = await requireProjectOwner(projectId);

  const { data: providers } = await supabase.from("providers").select("id");
  if (!(providers ?? []).some((p) => p.id === providerId)) {
    throw new Error("프로바이더 선택이 올바르지 않습니다.");
  }
  const trimmed = model.trim();
  if (!trimmed) throw new Error("모델을 입력하세요.");

  // 기존 라우팅을 조회해 스프레드 보존(다른 용도·default 키 유지) — 배치 1 원칙.
  const { data: current } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  const routing: ModelRouting = { ...(current?.model_routing as ModelRouting) };
  routing.rubric = { provider_id: providerId, model: trimmed };

  const { error } = await supabase
    .from("projects")
    .update({ model_routing: routing })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/rubric`);
}

// ── 평가계획서 파일 → 분석용 텍스트 추출 (쓰기 없음) ────────────────────
// 예시 생기부 인제스트와 동일한 파서·상한을 재사용한다(lib/records/example-file).
export async function extractPlanText(
  projectId: string,
  formData: FormData,
): Promise<{ text: string; filename: string }> {
  await requireProjectOwner(projectId);
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("파일이 없습니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await extractTextFromExampleFile(file.name, bytes);
  return { text, filename: file.name };
}

// 평가계획서 텍스트 → 루브릭 기준 제안 (쓰기 없음, 자동 반영 금지 — 교사 승인 필수).
// 루브릭 전담 모델(rubric ?? default ?? evaluate)로 호출한다.
export async function analyzeRubricPlan(
  projectId: string,
  planText: string,
): Promise<RubricCriterion[]> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const clean = planText.trim();
  if (!clean) throw new Error("평가계획서 텍스트를 입력하세요.");

  const { data: project } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const routing = project.model_routing as ModelRouting;
  const overrideTarget: ModelTarget | undefined =
    routing.rubric ?? routing.default ?? routing.evaluate;

  const res = await callLLM({
    userId,
    purpose: "평가",
    modelRouting: routing,
    overrideTarget,
    temperature: 0,
    messages: buildRubricPlanMessages(clean),
  });
  return parseRubricPlan(res.text);
}

// LLM 응답(JSON 배열)을 RubricCriterion[]로 파싱·클램프한다. id는 서버가 부여한다.
// 기준 2~8개, max_score 1~100 정수, weight ≥ 0. 형식 오류는 명시적 에러.
function parseRubricPlan(text: string): RubricCriterion[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("분석 결과에서 기준을 찾지 못했습니다.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("분석 결과 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("분석 결과 형식이 올바르지 않습니다.");
  }
  const out: RubricCriterion[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const description =
      typeof rec.description === "string" ? rec.description.trim() : "";
    const rawMax = Number(rec.max_score);
    const max_score = Number.isFinite(rawMax)
      ? Math.max(1, Math.min(100, Math.round(rawMax)))
      : 10;
    const rawWeight = Number(rec.weight);
    const weight = Number.isFinite(rawWeight) && rawWeight >= 0 ? rawWeight : 1;
    out.push({ id: randomUUID(), name, description, max_score, weight });
    if (out.length >= 8) break; // 최대 8개
  }
  if (out.length === 0) {
    throw new Error("추출된 평가 기준이 없습니다. 계획서 내용을 확인하세요.");
  }
  return out;
}
