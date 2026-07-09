"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireApproved } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { requireProjectOwner } from "@/lib/projects";
import { buildDefaultModelRouting } from "@/lib/llm/routing";
import type {
  CountMethod,
  Database,
  FileRetentionDays,
  GradingScheme,
  RubricCriterion,
  ScoreAggregation,
  TieBreak,
} from "@/lib/supabase/types";

// 프로젝트 생성 시 심는 기본 루브릭 (SPEC 4절, DATA_MODEL 6절). 배점 10·가중치 1 균등.
function defaultRubricCriteria(): RubricCriterion[] {
  const seed: Array<Pick<RubricCriterion, "name" | "description">> = [
    { name: "과제 이해도", description: "과제의 요구와 목표를 정확히 파악했는가" },
    { name: "탐구 과정의 구체성", description: "탐구·활동 과정을 구체적이고 논리적으로 전개했는가" },
    { name: "사고의 깊이", description: "분석·해석·비판 등 사고의 깊이가 드러나는가" },
    { name: "표현·완성도", description: "표현이 명료하고 결과물의 완성도가 높은가" },
  ];
  return seed.map((c) => ({
    id: randomUUID(),
    name: c.name,
    description: c.description,
    max_score: 10,
    weight: 1,
  }));
}

// ── 프로젝트 생성 ─────────────────────────────────────────────────────
export async function createProject(formData: FormData) {
  const { userId } = await requireApproved();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("프로젝트 이름을 입력하세요.");

  const supabase = await createClient();

  // model_routing 기본값 = DEFAULT_MODELS + 이름으로 조회한 anthropic 시드 프로바이더 id.
  const { data: anthropic, error: provErr } = await supabase
    .from("providers")
    .select("id")
    .eq("name", "anthropic")
    .maybeSingle();
  if (provErr) throw new Error(provErr.message);
  if (!anthropic) {
    throw new Error(
      "기본 프로바이더(anthropic)가 없습니다. 관리자에게 문의하세요.",
    );
  }
  const model_routing = buildDefaultModelRouting(anthropic.id);

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      owner_id: userId,
      name,
      description: description || null,
      model_routing,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // 기본 루브릭 1행 시드 (프로젝트당 1행 unique).
  const { error: rubricErr } = await supabase
    .from("rubrics")
    .insert({ project_id: project.id, criteria: defaultRubricCriteria() });
  if (rubricErr) throw new Error(rubricErr.message);

  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}

// ── 프로젝트 이름·설명 수정 ───────────────────────────────────────────
export async function updateProject(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { supabase } = await requireProjectOwner(projectId);

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("프로젝트 이름을 입력하세요.");

  const { error } = await supabase
    .from("projects")
    .update({ name, description: description || null })
    .eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
}

// ── 프로젝트 삭제 (하위 students/rubrics는 FK on delete cascade) ───────
export async function deleteProject(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { supabase } = await requireProjectOwner(projectId);

  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath("/");
  redirect("/");
}

// ── 프로젝트 설정 저장 ────────────────────────────────────────────────
const GRADING_SCHEMES: GradingScheme[] = ["grade5", "grade9"];
const COUNT_METHODS: CountMethod[] = ["chars", "bytes"];
const AGGREGATIONS: ScoreAggregation[] = ["sum", "avg", "weighted"];
const TIE_BREAKS: TieBreak[] = ["best_grade", "mid_rank"];

export async function updateProjectSettings(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { supabase } = await requireProjectOwner(projectId);

  const grading_scheme = String(formData.get("grading_scheme")) as GradingScheme;
  const count_method = String(formData.get("count_method")) as CountMethod;
  const score_aggregation = String(
    formData.get("score_aggregation"),
  ) as ScoreAggregation;
  const tie_break = String(formData.get("tie_break")) as TieBreak;
  const char_limit = Number(formData.get("char_limit"));
  const retentionRaw = String(formData.get("file_retention_days") ?? "off");

  if (!GRADING_SCHEMES.includes(grading_scheme)) {
    throw new Error("등급제 값이 올바르지 않습니다.");
  }
  if (!COUNT_METHODS.includes(count_method)) {
    throw new Error("글자수 카운트 방식이 올바르지 않습니다.");
  }
  if (!AGGREGATIONS.includes(score_aggregation)) {
    throw new Error("합성 점수 방식이 올바르지 않습니다.");
  }
  if (!TIE_BREAKS.includes(tie_break)) {
    throw new Error("동점자 처리 방식이 올바르지 않습니다.");
  }
  if (!Number.isInteger(char_limit) || char_limit < 1 || char_limit > 100000) {
    throw new Error("글자수 제한은 1 이상의 정수여야 합니다.");
  }

  let file_retention_days: FileRetentionDays = null;
  if (retentionRaw === "7") file_retention_days = 7;
  else if (retentionRaw === "30") file_retention_days = 30;
  else if (retentionRaw !== "off") {
    throw new Error("원본 자동 삭제 정책 값이 올바르지 않습니다.");
  }

  // 합성/동점 방식이 바뀌면 합성 점수·순위·등급이 달라지므로 "재계산 필요"를 표시한다
  // (grading_scheme은 파생 표시라 재계산 불필요 — 화면 즉시 반영). 세션 7, DECISIONS 2026-07-09.
  const { data: current } = await supabase
    .from("projects")
    .select("score_aggregation, tie_break")
    .eq("id", projectId)
    .maybeSingle();
  const scoringChanged =
    !!current &&
    (current.score_aggregation !== score_aggregation ||
      current.tie_break !== tie_break);

  const patch: Database["public"]["Tables"]["projects"]["Update"] = {
    grading_scheme,
    count_method,
    score_aggregation,
    tie_break,
    char_limit,
    file_retention_days,
  };
  if (scoringChanged) patch.needs_recalc = true;

  const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
}
