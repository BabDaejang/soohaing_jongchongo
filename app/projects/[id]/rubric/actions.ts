"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireProjectOwner } from "@/lib/projects";
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
}
