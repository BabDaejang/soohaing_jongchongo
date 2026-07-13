"use server";

import { revalidatePath } from "next/cache";
import { requireProjectOwner } from "@/lib/projects";
import { listRoutableProviders } from "@/lib/llm/available";
import { recommendCostEffective, type ModelCandidate } from "@/lib/llm/recommend";
import type { ModelRouting, RoutingKey } from "@/lib/llm/types";

// 페이즈 0의 "기본 AI 모델" 저장/전파 (리팩토링 2 배치 5).
// model_routing.default 키를 다루며, extract/evaluate/generate/verify(및 배치 7의 rubric)
// 는 배치 1의 updateModelRouting과 동일한 원칙으로 스프레드 보존한다.

const ROUTING_KEYS: RoutingKey[] = ["extract", "evaluate", "generate", "verify"];

const PURPOSE_LABELS: Record<RoutingKey, string> = {
  extract: "추출·매칭",
  evaluate: "평가",
  generate: "생성",
  verify: "검증",
};

export type DiffingRouting = {
  key: RoutingKey;
  label: string;
  providerName: string;
  model: string;
};

// 기본 AI 모델을 저장하고, 4개 용도 중 이 값과 다른 항목 목록을 돌려준다(교체 질문용).
export async function saveDefaultModel(
  projectId: string,
  providerId: string,
  model: string,
): Promise<{ differing: DiffingRouting[] }> {
  const { supabase } = await requireProjectOwner(projectId);

  const { data: providers } = await supabase.from("providers").select("id, name");
  const rows = providers ?? [];
  if (!rows.some((p) => p.id === providerId)) {
    throw new Error("프로바이더 선택이 올바르지 않습니다.");
  }
  const trimmed = model.trim();
  if (!trimmed) throw new Error("모델을 입력하세요.");

  // 기존 라우팅을 조회해 스프레드 보존(extract/evaluate/generate/verify·rubric 유지).
  const { data: current } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  const routing: ModelRouting = { ...(current?.model_routing as ModelRouting) };
  routing.default = { provider_id: providerId, model: trimmed };

  const { error } = await supabase
    .from("projects")
    .update({ model_routing: routing })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);

  const nameById = new Map(rows.map((p) => [p.id, p.name]));
  const differing: DiffingRouting[] = [];
  for (const key of ROUTING_KEYS) {
    const target = routing[key];
    if (!target) continue;
    if (target.provider_id !== providerId || target.model !== trimmed) {
      differing.push({
        key,
        label: PURPOSE_LABELS[key],
        providerName: nameById.get(target.provider_id) ?? target.provider_id,
        model: target.model,
      });
    }
  }
  return { differing };
}

// 4개 용도(extract/evaluate/generate/verify)를 전부 기본 AI 모델로 교체한다(rubric·default 보존).
export async function applyDefaultToAllRouting(projectId: string): Promise<void> {
  const { supabase } = await requireProjectOwner(projectId);

  const { data: current } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  const routing: ModelRouting = { ...(current?.model_routing as ModelRouting) };
  if (!routing.default) {
    throw new Error("기본 AI 모델이 설정되어 있지 않습니다.");
  }
  for (const key of ROUTING_KEYS) {
    routing[key] = { ...routing.default };
  }

  const { error } = await supabase
    .from("projects")
    .update({ model_routing: routing })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}

// 가성비 추천 모델을 생성·검증(generate·verify) 라우팅에 적용한다(페이즈 3, 배치 7).
// 추천은 서버가 쓸 수 있는 키의 저장 모델 목록에서 재계산한다(화면 배지와 동일 함수).
export async function applyRecommendedGenerate(projectId: string): Promise<void> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  const providers = await listRoutableProviders(userId);
  const candidates: ModelCandidate[] = providers
    .filter((p) => p.keySource !== null)
    .flatMap((p) =>
      p.models.map((model) => ({
        providerId: p.id,
        providerName: p.name,
        model,
      })),
    );
  const rec = recommendCostEffective(candidates);
  if (!rec) {
    throw new Error(
      "추천할 모델이 없습니다. 계정 옵션에서 [모델 갱신]으로 모델 목록을 채워 주세요.",
    );
  }

  const { data: current } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  const routing: ModelRouting = { ...(current?.model_routing as ModelRouting) };
  const target = { provider_id: rec.providerId, model: rec.model };
  routing.generate = target;
  routing.verify = { ...target };

  const { error } = await supabase
    .from("projects")
    .update({ model_routing: routing })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
}
