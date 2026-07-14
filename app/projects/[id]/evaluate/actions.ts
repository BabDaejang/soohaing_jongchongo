"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireProjectOwner } from "@/lib/projects";
import { createAdminClient } from "@/lib/supabase/admin";
import { callLLM } from "@/lib/llm";
import type { ModelRouting, ModelTarget } from "@/lib/llm";
import { writeAuditLog } from "@/lib/audit";
import {
  aggregateComposite,
  submissionScore,
  type CriterionScore,
} from "@/lib/scoring";
import { computeStandings } from "@/lib/grading";
import { assignDisplayScores, initialConfirmCount } from "@/lib/scores/display";
import { searchBooks, hasAladinKey } from "@/lib/factsheet/aladin";
import { hasNaverKeys } from "@/lib/factsheet/naver";
import { fetchPageText } from "@/lib/factsheet/fetch-page";
import { planCollection, collectOneSource } from "@/lib/factsheet/build";
import {
  buildComparePrompt,
  buildIdentifyPrompt,
  extractUrls,
  parseFindings,
  parseSourceClaim,
  summarizeVerdict,
  normalizeBookString,
  buildBookKey,
  mergeAuthenticity,
  type Finding,
  type SourceClaim,
} from "@/lib/factsheet/authenticity";
import { metaAgrees } from "@/lib/factsheet/strict-review";
import { createFactsheetFromBook } from "@/app/factsheets/actions";
import type {
  AuthenticityStatus,
  Database,
  EvaluationCriterionScore,
  GradingScheme,
  MatchStatus,
  RubricCriterion,
  ScoreAggregation,
  TieBreak,
} from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type Admin = ReturnType<typeof createAdminClient>;

// 채점 대상 조건(혼입 방지): 반영 체크 + 매칭 확정 + 학생 귀속 제출물만.
const MATCHED_STATUSES: MatchStatus[] = ["auto_matched", "confirmed"];
const ROUTING_KEYS = ["extract", "evaluate", "generate", "verify"] as const;
const GRADING_SCHEMES: GradingScheme[] = ["grade5", "grade9"];

// ── 채점 프롬프트·파싱 ────────────────────────────────────────────────
function buildEvalPrompt(criteria: RubricCriterion[], content: string): string {
  const rubricText = criteria
    .map((c) => `- id:${c.id} | ${c.name} (0~${c.max_score}점): ${c.description}`)
    .join("\n");
  return [
    "너는 학생 수행평가 채점자다. 아래 루브릭 기준에 따라 제출물을 각 기준의 0점부터 만점까지 정수로 채점하라.",
    "각 기준 점수마다 제출물 원문에서 판단의 근거가 된 부분을 그대로 인용하라(근거 없는 채점 금지).",
    "근거를 찾지 못하면 점수를 낮게 주고 인용은 빈 문자열로 둔다.",
    "반드시 아래 JSON 배열 형식으로만 답하라(설명·다른 텍스트 금지):",
    '[{"criterion_id":"<루브릭 id>","score":<정수>,"evidence_quote":"<원문 인용>"}]',
    "",
    "[루브릭 기준]",
    rubricText,
    "",
    "[제출물 원문]",
    content,
  ].join("\n");
}

function parseEvalScores(
  text: string,
  criteria: RubricCriterion[],
): { scores: EvaluationCriterionScore[]; total: number } {
  const byId = new Map<string, { score: number; evidence: string }>();
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item !== "object" || item === null) continue;
          const rec = item as Record<string, unknown>;
          const cid = typeof rec.criterion_id === "string" ? rec.criterion_id : null;
          if (!cid) continue;
          const rawScore =
            typeof rec.score === "number" ? rec.score : Number(rec.score);
          const evidence =
            typeof rec.evidence_quote === "string" ? rec.evidence_quote : "";
          byId.set(cid, {
            score: Number.isFinite(rawScore) ? rawScore : 0,
            evidence,
          });
        }
      }
    } catch {
      // 파싱 실패 → 전 기준 0점(아래 map에서 처리)
    }
  }
  // 루브릭 기준 순서로 정규화: 각 점수를 [0, max_score]로 클램프, 누락은 0점.
  const scores: EvaluationCriterionScore[] = criteria.map((c) => {
    const found = byId.get(c.id);
    const clamped = found ? Math.max(0, Math.min(c.max_score, found.score)) : 0;
    return { criterion_id: c.id, score: clamped, evidence_quote: found?.evidence ?? "" };
  });
  const total = scores.reduce((s, x) => s + x.score, 0);
  return { scores, total };
}

// ── 합성·표시 점수·순위·등급 재계산 후 student_scores 저장 (INV-6: service role 배치만 write) ──
// 999점 표시 점수(display_score)를 끼워 넣는다: 초기 확정 인원 미달이면 확정하지 않고(행 미생성),
// 충족하면 원점수 순위로 스프레드하되 이전 배정은 유지(sticky). effective = override ?? display.
export type RecomputeResult = {
  ranked: number; // 확정 시 student_scores에 기록된 학생 수(미확정이면 0)
  pendingConfirm: { scored: number; required: number } | null; // 미확정 국면 정보
};

async function recomputeAndSave(
  projectId: string,
  supabase: Client,
  admin: Admin,
): Promise<RecomputeResult> {
  const { data: project } = await supabase
    .from("projects")
    .select("score_aggregation, grading_scheme, tie_break")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("프로젝트를 찾을 수 없습니다.");
  const aggregation = project.score_aggregation as ScoreAggregation;
  const scheme = project.grading_scheme as GradingScheme;
  const tieBreak = project.tie_break as TieBreak;

  const { data: rubric } = await supabase
    .from("rubrics")
    .select("criteria")
    .eq("project_id", projectId)
    .maybeSingle();
  const criteria = (rubric?.criteria ?? []) as RubricCriterion[];

  const { data: students } = await supabase
    .from("students")
    .select("id, score_override")
    .eq("project_id", projectId);

  // 반영+매칭 제출물 → 학생 매핑
  const { data: subs } = await supabase
    .from("submissions")
    .select("id, student_id")
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);
  const subToStudent = new Map<string, string>();
  for (const s of subs ?? []) if (s.student_id) subToStudent.set(s.id, s.student_id);

  // 현재 평가만 집계
  const { data: evals } = await admin
    .from("evaluations")
    .select("submission_id, scores")
    .eq("project_id", projectId)
    .eq("is_current", true);

  const perStudent = new Map<string, number[]>();
  for (const e of evals ?? []) {
    const studentId = subToStudent.get(e.submission_id);
    if (!studentId) continue; // 제외/미매칭 제출물의 평가는 순위에서 무시
    const cScores = e.scores.map<CriterionScore>((s) => ({
      criterion_id: s.criterion_id,
      score: s.score,
    }));
    const subScore = submissionScore(cScores, criteria, aggregation);
    const arr = perStudent.get(studentId) ?? [];
    arr.push(subScore);
    perStudent.set(studentId, arr);
  }

  // 랭킹 대상: 평가가 있거나 override가 설정된 학생.
  type Row = {
    studentId: string;
    composite: number;
    override: number | null;
    hasEval: boolean;
  };
  const rows: Row[] = [];
  for (const st of students ?? []) {
    const subScores = perStudent.get(st.id) ?? [];
    const override = st.score_override;
    const hasEval = subScores.length > 0;
    if (!hasEval && override === null) continue;
    const composite = aggregateComposite(subScores, aggregation);
    rows.push({ studentId: st.id, composite, override, hasEval });
  }

  // 이전 표시 점수 배정(sticky) — 삭제 전에 조회. null 값(override만 있던 행)은 제외.
  const { data: prior } = await admin
    .from("student_scores")
    .select("student_id, display_score")
    .eq("project_id", projectId);
  const existing = new Map<string, number>();
  for (const p of prior ?? []) {
    if (p.display_score !== null) existing.set(p.student_id, p.display_score);
  }

  // 채점 대상 총수 = 제출물이 귀속된 학생 수(미채점 포함). override만 있는 학생은 제외.
  const totalTargets = new Set(subToStudent.values()).size;

  // 원점수(composite) 내림차순, 동률은 studentId 사전순(결정성).
  const rawRanked = rows
    .filter((r) => r.hasEval)
    .sort(
      (a, b) =>
        b.composite - a.composite || (a.studentId < b.studentId ? -1 : 1),
    )
    .map((r) => ({ studentId: r.studentId, raw: r.composite }));

  const { displays, confirmed } = assignDisplayScores({
    rawRanked,
    existing,
    totalTargets,
  });

  // 미확정 국면: 표시 점수를 확정하지 않는다 — 기존 스냅샷을 지우기만 하고 삽입하지 않는다.
  if (!confirmed) {
    await admin.from("student_scores").delete().eq("project_id", projectId);
    await admin.from("projects").update({ needs_recalc: false }).eq("id", projectId);
    return {
      ranked: 0,
      pendingConfirm: {
        scored: rawRanked.length,
        required: initialConfirmCount(totalTargets),
      },
    };
  }

  // 확정: effective = override ?? display. override만 있고 평가 없는 학생은 display=null.
  const withDisplay = rows.map((r) => {
    const display = displays.get(r.studentId) ?? null;
    const effective = r.override ?? display ?? 0; // 둘 다 null은 발생하지 않음(위 필터)
    return { ...r, display, effective };
  });

  const standings = computeStandings(
    withDisplay.map((r) => r.effective),
    scheme,
    tieBreak,
  );

  const nowIso = new Date().toISOString();
  const inserts = withDisplay.map((r, i) => ({
    project_id: projectId,
    student_id: r.studentId,
    composite_score: r.composite,
    display_score: r.display,
    effective_score: r.effective,
    rank: standings[i].rank,
    grade: standings[i].grade,
    calculated_at: nowIso,
  }));

  // 결정적 재작성: 기존 순위 스냅샷을 지우고 대상만 다시 삽입(탈락 학생 제거).
  await admin.from("student_scores").delete().eq("project_id", projectId);
  if (inserts.length > 0) {
    const { error } = await admin.from("student_scores").insert(inserts);
    if (error) throw new Error(`순위 저장 실패: ${error.message}`);
  }

  await admin.from("projects").update({ needs_recalc: false }).eq("id", projectId);
  return { ranked: withDisplay.length, pendingConfirm: null };
}

// ── 평가 실행 — 클라이언트 구동 1건 단위(prepare → evaluateOne × N → finalize) ──
// 전건을 한 서버 액션에서 돌리던 이전 구조는 진행 표시·중단이 불가하고 성공 시
// 타임아웃이 확정이라, 실행 터미널(useSequentialRun)이 건별로 호출하는 구조로 나눴다.
export type EvalTarget = { id: string; label: string }; // label = "학번 이름"(+ " · 파일명")

// 채점 대상 목록·라벨과 증분 보존 건수를 조립한다(LLM 호출 없음).
export async function prepareEvaluation(
  projectId: string,
): Promise<{ targets: EvalTarget[]; skipped: number }> {
  const { supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const { data: rubric } = await supabase
    .from("rubrics")
    .select("criteria")
    .eq("project_id", projectId)
    .maybeSingle();
  const criteria = (rubric?.criteria ?? []) as RubricCriterion[];
  if (criteria.length === 0) {
    throw new Error("루브릭 기준이 없습니다. 먼저 루브릭을 설정하세요.");
  }

  const { data: subs } = await supabase
    .from("submissions")
    .select("id, student_id, source_filename, content_hash")
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);
  const rows = subs ?? [];

  // label용 학생 정보(학번·이름)는 students 1회 조회로 조인.
  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const studentById = new Map((students ?? []).map((s) => [s.id, s]));

  // 증분: 현재 평가(is_current)의 content_hash와 같으면 재채점 대상에서 제외(보존).
  const ids = rows.map((r) => r.id);
  const currentBySub = new Map<string, string>();
  if (ids.length > 0) {
    const { data: existing } = await admin
      .from("evaluations")
      .select("submission_id, content_hash")
      .in("submission_id", ids)
      .eq("is_current", true);
    for (const e of existing ?? []) currentBySub.set(e.submission_id, e.content_hash);
  }

  const targets: EvalTarget[] = [];
  let skipped = 0;
  for (const r of rows) {
    const existingHash = currentBySub.get(r.id);
    if (existingHash !== undefined && existingHash === r.content_hash) {
      skipped += 1; // 증분: 내용 불변 → 재채점 안 함(기존 평가 보존)
      continue;
    }
    const st = r.student_id ? studentById.get(r.student_id) : undefined;
    const who = st ? `${st.student_number ?? "?"} ${st.name}`.trim() : "(미상)";
    const label = r.source_filename ? `${who} · ${r.source_filename}` : who;
    targets.push({ id: r.id, label });
  }

  return { targets, skipped };
}

// 제출물 1건 채점(터미널이 반복 호출). 에러는 버리지 않고 message로 돌려준다.
// 클라이언트 입력은 id뿐 — 루브릭·라우팅은 서버가 DB에서 재조립한다(INV-2).
export async function evaluateOne(
  projectId: string,
  submissionId: string,
): Promise<{ ok: boolean; message: string; retryable?: boolean }> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const { data: rubric } = await supabase
    .from("rubrics")
    .select("criteria")
    .eq("project_id", projectId)
    .maybeSingle();
  const criteria = (rubric?.criteria ?? []) as RubricCriterion[];
  if (criteria.length === 0) {
    return { ok: false, message: "루브릭 기준이 없습니다." };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  const routing: ModelRouting = project.model_routing;

  // 제출물 소속·자격 재확인(다른 프로젝트·미매칭·미반영 제출물 차단).
  const { data: sub } = await supabase
    .from("submissions")
    .select(
      "id, content_text, content_hash, include_in_eval, student_id, match_status",
    )
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (
    !sub ||
    !sub.include_in_eval ||
    !sub.student_id ||
    !MATCHED_STATUSES.includes(sub.match_status)
  ) {
    return { ok: false, message: "채점 대상이 아닌 제출물입니다." };
  }

  // 동시 탭 방어: 채점 직전 현재 평가 해시를 재확인 — 같으면 이미 채점됨(증분).
  const { data: current } = await admin
    .from("evaluations")
    .select("content_hash")
    .eq("submission_id", submissionId)
    .eq("is_current", true)
    .maybeSingle();
  if (current && current.content_hash === sub.content_hash) {
    return { ok: true, message: "이미 채점됨(증분)" };
  }

  // temperature 0으로 결정성 요청 — gpt-5 계열은 배치 1 어댑터가 temperature를 자동 생략한다.
  let text: string;
  let model: string;
  try {
    const res = await callLLM({
      userId,
      purpose: "평가",
      modelRouting: routing,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: buildEvalPrompt(criteria, sub.content_text.slice(0, 12000)),
        },
      ],
    });
    text = res.text;
    model = res.model;
  } catch (e) {
    // 더 이상 버리지 않는다 — 원인을 그대로 돌려 터미널·서킷 브레이커가 표시하게 한다.
    const msg = e instanceof Error ? e.message : "LLM 호출 실패";
    const isRetryable =
      e instanceof Error &&
      ("status" in e) &&
      (e.status === 429 || e.status === 503 || e.status === 529);
    return { ok: false, message: msg.slice(0, 300), retryable: isRetryable };
  }

  const { scores, total } = parseEvalScores(text, criteria);

  // partial unique(submission_id where is_current) 충돌 방지: 이전 현재 평가를 먼저 내린다.
  if (current) {
    await admin
      .from("evaluations")
      .update({ is_current: false })
      .eq("submission_id", submissionId)
      .eq("is_current", true);
  }
  const { error: insErr } = await admin.from("evaluations").insert({
    submission_id: submissionId,
    project_id: projectId,
    scores,
    total_score: total,
    content_hash: sub.content_hash,
    raw_llm_output: text,
    model,
    is_current: true,
  });
  if (insErr) {
    return { ok: false, message: `평가 저장 실패: ${insErr.message}`.slice(0, 300) };
  }

  return { ok: true, message: `원점수 ${total}점` };
}

// 실행 종료 후 1회: 합성·순위·등급 재계산 → 감사 로그 → revalidate.
// revalidatePath는 여기서만 — 건별로 하면 매 건 RSC 재조회가 낭비다.
export async function finalizeEvaluation(
  projectId: string,
  counts: { scored: number; failed: number; skipped: number },
  aborted: boolean,
  sampleFailure?: string, // 클라이언트가 수집한 대표 실패 사유
): Promise<RecomputeResult> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const result = await recomputeAndSave(projectId, supabase, admin);

  await writeAuditLog({
    actorId: userId,
    action: "evaluation.run",
    entity: "projects",
    entityId: projectId,
    detail: {
      scored: counts.scored,
      failed: counts.failed,
      skipped: counts.skipped,
      aborted,
      ...(sampleFailure ? { sample_failure: sampleFailure.slice(0, 300) } : {}),
    },
  });

  revalidatePath(`/projects/${projectId}`);
  return result;
}

interface AuthenticityJson {
  claim?: SourceClaim;
  isbn13?: string | null;
  urls?: string[];
  content_hash?: string;
  identified_at?: string;
  findings?: Finding[];
  factsheet_id?: string | null;
  model?: string | null;
  checked_at?: string;
}

// ── 진실성 검증 — 채점 앞 스테이지(식별→팩트시트 확보/자동 생성→대조→플래그) ──
// 리팩토링 2 배치 10. 의심이어도 채점은 진행한다(플래그만 — 자동 감점·제외 없음).
// authenticity_status·authenticity·factsheet_id는 채점처럼 서버(service role)가 채운다.
const AUTH_ENRICH_THRESHOLD = 5; // 내 소유 팩트시트가 이보다 부실하면 대조 전 자동 보강 1회
const AUTH_COLLECT_MAX = 6; // 진실성 검증 중 자동 수집하는 문서 상한(시간 방어)
const AUTH_URL_FETCH_MAX = 3; // 대조에 쓰는 인용 URL 원문 수 상한
const AUTH_ENTRY_MAX = 40; // 증거로 넣는 팩트시트 entry 상한
const AUTH_ENTRY_TEXT_MAX = 800; // entry 증거 절단
const AUTH_URL_TEXT_MAX = 6000; // URL 원문 증거 절단
const AUTH_META_TEXT_MAX = 3500; // 팩트시트 메타 증거 절단

export async function prepareSourceIdentify(
  projectId: string,
): Promise<{ targets: EvalTarget[]; skipped: number }> {
  const { supabase } = await requireProjectOwner(projectId);

  const { data: subs } = await supabase
    .from("submissions")
    .select(
      "id, student_id, source_filename, content_hash, authenticity_status, authenticity",
    )
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);
  const rows = subs ?? [];

  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const studentById = new Map((students ?? []).map((s) => [s.id, s]));

  const targets: EvalTarget[] = [];
  let skipped = 0;
  for (const r of rows) {
    const prev = (r.authenticity ?? null) as AuthenticityJson | null;
    const upToDate =
      (r.authenticity_status === "not_applicable" || (prev && prev.claim !== undefined)) &&
      prev?.content_hash === r.content_hash;
    if (upToDate) {
      skipped += 1;
      continue;
    }
    const st = r.student_id ? studentById.get(r.student_id) : undefined;
    const who = st ? `${st.student_number ?? "?"} ${st.name}`.trim() : "(미상)";
    const label = r.source_filename ? `${who} · ${r.source_filename}` : who;
    targets.push({ id: r.id, label });
  }
  return { targets, skipped };
}

export async function identifySourceOne(
  projectId: string,
  submissionId: string,
): Promise<{
  ok: boolean;
  message: string;
  retryable?: boolean;
  info?: { kind: "book" | "web" | "none"; isbnConfirmed: boolean };
}> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  const { data: sub } = await supabase
    .from("submissions")
    .select(
      "id, content_text, content_hash, include_in_eval, student_id, match_status, authenticity_status, authenticity",
    )
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (
    !sub ||
    !sub.include_in_eval ||
    !sub.student_id ||
    !MATCHED_STATUSES.includes(sub.match_status)
  ) {
    return { ok: false, message: "식별 대상이 아닌 제출물입니다." };
  }

  const prev = (sub.authenticity ?? null) as AuthenticityJson | null;
  const upToDate =
    (sub.authenticity_status === "not_applicable" || (prev && prev.claim !== undefined)) &&
    prev?.content_hash === sub.content_hash;
  if (upToDate) {
    return { ok: true, message: "이미 식별됨(증분)" };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  const routing: ModelRouting = project.model_routing;

  const content = sub.content_text ?? "";
  const checkedAt = new Date().toISOString();

  const urls = extractUrls(content);
  let claim: SourceClaim;
  try {
    const res = await callLLM({
      userId,
      purpose: "추출",
      modelRouting: routing,
      temperature: 0,
      messages: [{ role: "user", content: buildIdentifyPrompt(content) }],
    });
    claim = parseSourceClaim(res.text);
  } catch (e) {
    const isRetryable =
      e instanceof Error &&
      ("status" in e) &&
      (e.status === 429 || e.status === 503 || e.status === 529);
    return {
      ok: false,
      message: (e instanceof Error ? e.message : "출처 식별 실패").slice(0, 300),
      retryable: isRetryable,
    };
  }

  if (claim.kind === "none" && urls.length === 0) {
    const existingAuth = (sub.authenticity as Record<string, unknown>) || {};
    const updatedAuth = mergeAuthenticity(existingAuth, {
      claim,
      isbn13: null,
      urls: [],
      content_hash: sub.content_hash,
      identified_at: checkedAt,
    });
    const save = await saveAuthenticity(admin, submissionId, projectId, "not_applicable", updatedAuth, null);
    if (!save.ok) return { ok: false, message: (save.message ?? "저장 실패").slice(0, 300) };
    return {
      ok: true,
      message: "출처 인용 없음",
      info: { kind: "none", isbnConfirmed: false },
    };
  }

  let isbn13: string | null = null;
  let matchesAladin = false;
  if (claim.kind === "book" && claim.title) {
    if (hasAladinKey()) {
      try {
        const query = claim.author ? `${claim.title} ${claim.author}` : claim.title;
        const candidates = await searchBooks(query);
        for (const c of candidates) {
          const expected = { title: claim.title, author: claim.author ?? null };
          const found = { title: c.title, author: c.author };
          const cmp = metaAgrees(expected, found);
          if (cmp.title && cmp.author) {
            isbn13 = c.isbn13;
            matchesAladin = true;
            break;
          }
        }
      } catch (e) {
        const isRetryable =
          e instanceof Error &&
          ("status" in e) &&
          (e.status === 429 || e.status === 503 || e.status === 529);
        if (isRetryable) {
          return {
            ok: false,
            message: `알라딘 API 오류: ${e.message}`.slice(0, 300),
            retryable: true,
          };
        }
      }
    }
  }

  const existingAuth = (sub.authenticity as Record<string, unknown>) || {};
  const updatedAuth = mergeAuthenticity(existingAuth, {
    claim,
    isbn13,
    urls,
    content_hash: sub.content_hash,
    identified_at: checkedAt,
  });
  const save = await saveAuthenticity(admin, submissionId, projectId, "unverified", updatedAuth, null);
  if (!save.ok) return { ok: false, message: (save.message ?? "저장 실패").slice(0, 300) };

  let message = "";
  const infoKind = claim.kind === "book" ? ("book" as const) : ("web" as const);
  if (claim.kind === "book") {
    if (matchesAladin && isbn13) {
      message = `『${claim.title}』 → ISBN 확정`;
    } else {
      message = `『${claim.title}』 — 알라딘 미등재(제목 매칭)`;
    }
  } else if (urls.length > 0) {
    message = `URL 인용 ${urls.length}건`;
  } else {
    message = "출처 식별 완료";
  }

  return {
    ok: true,
    message,
    info: { kind: infoKind, isbnConfirmed: matchesAladin && isbn13 !== null },
  };
}

export async function prepareFactsheetStage(
  projectId: string,
): Promise<{
  targets: EvalTarget[];
  prelude: { level: "info" | "system"; text: string }[];
}> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  if (!hasAladinKey()) {
    return {
      targets: [],
      prelude: [
        {
          level: "system",
          text: "알라딘 API 키가 등록되지 않아 팩트시트 자동 준비 단계가 활성화되지 않았습니다.",
        },
      ],
    };
  }

  const { data: subs } = await supabase
    .from("submissions")
    .select("authenticity")
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);

  const bookClaims = new Map<string, { title: string; author: string | null; isbn13: string | null }>();

  for (const s of subs ?? []) {
    const auth = s.authenticity as AuthenticityJson | null;
    if (auth && auth.claim && auth.claim.kind === "book" && auth.claim.title) {
      const title = auth.claim.title;
      const author = auth.claim.author ?? null;
      const isbn13 = auth.isbn13 ?? null;

      const bookKey = buildBookKey(title, author, isbn13);

      if (!bookClaims.has(bookKey)) {
        bookClaims.set(bookKey, { title, author, isbn13 });
      }
    }
  }

  const { data: factsheets } = await supabase
    .from("factsheets")
    .select("isbn13, title, author")
    .or(`owner_id.eq.${userId},share_status.eq.shared`);

  const securedKeys = new Set<string>();
  for (const fs of factsheets ?? []) {
    if (fs.isbn13) {
      securedKeys.add(`isbn:${fs.isbn13}`);
    }
    const fallbackKey = `title:${normalizeBookString(fs.title)}|${normalizeBookString(fs.author ?? "")}`;
    securedKeys.add(fallbackKey);
  }

  const targets: EvalTarget[] = [];
  let securedCount = 0;

  for (const [bookKey, info] of bookClaims.entries()) {
    let isSecured = false;
    if (info.isbn13 && securedKeys.has(`isbn:${info.isbn13}`)) {
      isSecured = true;
    }
    const titleAuthorKey = `title:${normalizeBookString(info.title)}|${normalizeBookString(info.author ?? "")}`;
    if (securedKeys.has(titleAuthorKey)) {
      isSecured = true;
    }

    if (isSecured) {
      securedCount += 1;
    } else {
      const label = info.author ? `『${info.title}』 (${info.author})` : `『${info.title}』`;
      targets.push({ id: bookKey, label });
    }
  }

  return {
    targets,
    prelude: [
      {
        level: "info",
        text: `준비 대상 책 ${targets.length}권 · 기확보 ${securedCount}권 재사용`,
      },
    ],
  };
}

export async function prepareFactsheetOne(
  projectId: string,
  bookKey: string,
): Promise<{
  ok: boolean;
  message: string;
  retryable?: boolean;
  info?: { status: "reuse" | "create" | "fail" };
}> {
  const { userId, supabase } = await requireProjectOwner(projectId);

  let isbn13: string | null = null;
  let title = "";
  let author: string | null = null;

  if (bookKey.startsWith("isbn:")) {
    isbn13 = bookKey.slice(5);
  } else if (bookKey.startsWith("title:")) {
    const parts = bookKey.slice(6).split("|");
    title = parts[0];
    author = parts[1] || null;
  }

  let foundId: string | null = null;
  let isMine = false;
  let factsheetTitle = "";
  let factsheetAuthor: string | null = null;

  if (isbn13) {
    const { data: mine } = await supabase
      .from("factsheets")
      .select("id, title, author, owner_id")
      .eq("owner_id", userId)
      .eq("isbn13", isbn13)
      .maybeSingle();
    if (mine) {
      foundId = mine.id;
      isMine = true;
      factsheetTitle = mine.title;
      factsheetAuthor = mine.author;
    } else {
      const { data: shared } = await supabase
        .from("factsheets")
        .select("id, title, author, owner_id")
        .eq("share_status", "shared")
        .eq("isbn13", isbn13)
        .maybeSingle();
      if (shared) {
        foundId = shared.id;
        isMine = shared.owner_id === userId;
        factsheetTitle = shared.title;
        factsheetAuthor = shared.author;
      }
    }
  }

  if (!foundId) {
    const { data: allFs } = await supabase
      .from("factsheets")
      .select("id, title, author, owner_id, share_status, isbn13")
      .or(`owner_id.eq.${userId},share_status.eq.shared`);

    const expectedTitle = isbn13 ? "" : normalizeBookString(title);
    const expectedAuthor = isbn13 ? "" : normalizeBookString(author ?? "");

    const mineHit = allFs?.find((c) => {
      if (c.owner_id !== userId) return false;
      if (isbn13 && c.isbn13 === isbn13) return true;
      return (
        !isbn13 &&
        normalizeBookString(c.title) === expectedTitle &&
        normalizeBookString(c.author ?? "") === expectedAuthor
      );
    });

    if (mineHit) {
      foundId = mineHit.id;
      isMine = true;
      factsheetTitle = mineHit.title;
      factsheetAuthor = mineHit.author;
    } else {
      const sharedHit = allFs?.find((c) => {
        if (c.share_status !== "shared") return false;
        if (isbn13 && c.isbn13 === isbn13) return true;
        return (
          !isbn13 &&
          normalizeBookString(c.title) === expectedTitle &&
          normalizeBookString(c.author ?? "") === expectedAuthor
        );
      });
      if (sharedHit) {
        foundId = sharedHit.id;
        isMine = sharedHit.owner_id === userId;
        factsheetTitle = sharedHit.title;
        factsheetAuthor = sharedHit.author;
      }
    }
  }

  let created = false;
  if (!foundId) {
    if (!isbn13 && title) {
      try {
        const query = author ? `${title} ${author}` : title;
        const candidates = await searchBooks(query);
        for (const c of candidates) {
          const cmp = metaAgrees({ title, author }, { title: c.title, author: c.author });
          if (cmp.title && cmp.author) {
            isbn13 = c.isbn13;
            break;
          }
        }
      } catch (e) {
        const isRetryable =
          e instanceof Error &&
          ("status" in e) &&
          (e.status === 429 || e.status === 503 || e.status === 529);
        return {
          ok: false,
          message: `도서 검색 중 오류: ${e instanceof Error ? e.message : "오류"}`.slice(0, 80),
          retryable: isRetryable,
          info: { status: "fail" },
        };
      }
    }

    if (!isbn13) {
      return {
        ok: false,
        message: `『${title}』 수집 실패 (ISBN 미조회)`,
        info: { status: "fail" },
      };
    }

    try {
      const createdRes = await createFactsheetFromBook(isbn13);
      foundId = createdRes.id;
      created = true;
      isMine = true;

      const { data: newFs } = await supabase
        .from("factsheets")
        .select("title, author")
        .eq("id", foundId)
        .single();
      factsheetTitle = newFs?.title ?? "도서";
      factsheetAuthor = newFs?.author ?? null;
    } catch (e) {
      const isRetryable =
        e instanceof Error &&
        ("status" in e) &&
        (e.status === 429 || e.status === 503 || e.status === 529);
      return {
        ok: false,
        message: `『${title || isbn13}』 생성 실패: ${e instanceof Error ? e.message : "오류"}`.slice(0, 80),
        retryable: isRetryable,
        info: { status: "fail" },
      };
    }
  }

  const { data: project } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다.", info: { status: "fail" } };
  const routing: ModelRouting = project.model_routing;

  const { count } = await supabase
    .from("factsheet_entries")
    .select("id", { count: "exact", head: true })
    .eq("factsheet_id", foundId);
  let entryCount = count ?? 0;

  if (isMine && entryCount < AUTH_ENRICH_THRESHOLD) {
    let added = 0;
    try {
      added = await autoCollectFactsheet(
        userId,
        supabase,
        foundId,
        { title: factsheetTitle, author: factsheetAuthor },
        routing.extract,
      );
      entryCount += added;
    } catch (e) {
      const isRetryable =
        e instanceof Error &&
        ("status" in e) &&
        (e.status === 429 || e.status === 503 || e.status === 529);
      if (isRetryable) {
        return {
          ok: false,
          message: `보강 중 오류: ${e.message}`,
          retryable: true,
          info: { status: "fail" },
        };
      }
    }
  }

  if (created) {
    return {
      ok: true,
      message: `『${factsheetTitle}』 자동 생성 — entry ${entryCount}건`,
      info: { status: "create" },
    };
  } else {
    return {
      ok: true,
      message: `『${factsheetTitle}』 재사용(entry ${entryCount})`,
      info: { status: "reuse" },
    };
  }
}

// 검증 대상·라벨과 증분 보존 건수를 조립한다(LLM 없음). 채점 대상 조건과 동일한 제출물 중,
// 미검증이거나 검증 당시 content_hash가 현재와 다른 것(증분).
export async function prepareAuthenticity(
  projectId: string,
): Promise<{ targets: EvalTarget[]; skipped: number }> {
  const { supabase } = await requireProjectOwner(projectId);

  const { data: subs } = await supabase
    .from("submissions")
    .select(
      "id, student_id, source_filename, content_hash, authenticity_status, authenticity",
    )
    .eq("project_id", projectId)
    .eq("include_in_eval", true)
    .not("student_id", "is", null)
    .in("match_status", MATCHED_STATUSES);
  const rows = subs ?? [];

  const { data: students } = await supabase
    .from("students")
    .select("id, student_number, name")
    .eq("project_id", projectId);
  const studentById = new Map((students ?? []).map((s) => [s.id, s]));

  const targets: EvalTarget[] = [];
  let skipped = 0;
  for (const r of rows) {
    const prev = (r.authenticity ?? null) as { content_hash?: string } | null;
    const upToDate =
      r.authenticity_status !== "unverified" &&
      prev?.content_hash === r.content_hash;
    if (upToDate) {
      skipped += 1; // 증분: 내용 불변 + 이미 검증 → 재검증 안 함
      continue;
    }
    const st = r.student_id ? studentById.get(r.student_id) : undefined;
    const who = st ? `${st.student_number ?? "?"} ${st.name}`.trim() : "(미상)";
    const label = r.source_filename ? `${who} · ${r.source_filename}` : who;
    targets.push({ id: r.id, label });
  }
  return { targets, skipped };
}


// 내 소유 팩트시트를 자동 수집으로 보강한다(무할루시네이션: collectOneSource가 스니펫 대조 통과분만 저장).
async function autoCollectFactsheet(
  userId: string,
  supabase: Client,
  factsheetId: string,
  book: { title: string; author: string | null },
  extractTarget: ModelTarget,
): Promise<number> {
  if (!hasNaverKeys()) return 0;
  const { data: entries } = await supabase
    .from("factsheet_entries")
    .select("source_url")
    .eq("factsheet_id", factsheetId);
  const excludeUrls = (entries ?? [])
    .map((e) => e.source_url)
    .filter((u): u is string => !!u);
  let targets;
  try {
    targets = await planCollection(book, excludeUrls);
  } catch {
    return 0;
  }
  let added = 0;
  for (const target of targets.slice(0, AUTH_COLLECT_MAX)) {
    const r = await collectOneSource(userId, factsheetId, target, extractTarget);
    if (!r.ok && r.retryable) {
      const err = new Error(r.message);
      Object.defineProperty(err, "status", { value: 429, enumerable: true });
      throw err;
    }
    added += r.added;
  }
  return added;
}

// 제출물 1건 진실성 검증(터미널이 반복 호출). throw 금지 — {ok, message, status}로 돌려준다.
// 클라이언트 입력은 id뿐 — 내용·라우팅·명단은 서버가 DB에서 재조립한다(INV-2).
export async function verifyAuthenticityOne(
  projectId: string,
  submissionId: string,
): Promise<{ ok: boolean; message: string; status?: AuthenticityStatus; retryable?: boolean }> {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();

  // 1. 소속·자격 + 증분 재확인
  const { data: sub } = await supabase
    .from("submissions")
    .select(
      "id, content_text, content_hash, include_in_eval, student_id, match_status, authenticity_status, authenticity",
    )
    .eq("id", submissionId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (
    !sub ||
    !sub.include_in_eval ||
    !sub.student_id ||
    !MATCHED_STATUSES.includes(sub.match_status)
  ) {
    return { ok: false, message: "검증 대상이 아닌 제출물입니다." };
  }
  const prev = (sub.authenticity ?? null) as { content_hash?: string } | null;
  if (sub.authenticity_status !== "unverified" && prev?.content_hash === sub.content_hash) {
    return { ok: true, message: "이미 검증됨(증분)", status: sub.authenticity_status };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: "프로젝트를 찾을 수 없습니다." };
  const routing: ModelRouting = project.model_routing;

  const content = sub.content_text ?? "";
  const checkedAt = new Date().toISOString();

  const auth = sub.authenticity as AuthenticityJson | null;
  const claim = auth?.claim as SourceClaim | undefined;
  const isbn13 = auth?.isbn13 as string | null | undefined;
  const urls = (auth?.urls as string[]) || [];

  if (!claim) {
    return { ok: false, message: "출처 식별 데이터를 찾을 수 없습니다." };
  }

  // 2. 팩트시트 조회 (내 소유 -> shared)
  let factsheetId: string | null = null;
  if (claim.kind === "book" && claim.title) {
    if (isbn13) {
      const { data: mine } = await supabase
        .from("factsheets")
        .select("id")
        .eq("owner_id", userId)
        .eq("isbn13", isbn13)
        .maybeSingle();
      if (mine) {
        factsheetId = mine.id;
      } else {
        const { data: shared } = await supabase
          .from("factsheets")
          .select("id")
          .eq("share_status", "shared")
          .eq("isbn13", isbn13)
          .maybeSingle();
        if (shared) {
          factsheetId = shared.id;
        }
      }
    }

    if (!factsheetId) {
      const { data: allFs } = await supabase
        .from("factsheets")
        .select("id, title, author, owner_id, share_status, isbn13")
        .or(`owner_id.eq.${userId},share_status.eq.shared`);

      const expectedTitle = isbn13 ? "" : normalizeBookString(claim.title);
      const expectedAuthor = isbn13 ? "" : normalizeBookString(claim.author ?? "");

      const mineHit = allFs?.find((c) => {
        if (c.owner_id !== userId) return false;
        if (isbn13 && c.isbn13 === isbn13) return true;
        return (
          !isbn13 &&
          normalizeBookString(c.title) === expectedTitle &&
          normalizeBookString(c.author ?? "") === expectedAuthor
        );
      });

      if (mineHit) {
        factsheetId = mineHit.id;
      } else {
        const sharedHit = allFs?.find((c) => {
          if (c.share_status !== "shared") return false;
          if (isbn13 && c.isbn13 === isbn13) return true;
          return (
            !isbn13 &&
            normalizeBookString(c.title) === expectedTitle &&
            normalizeBookString(c.author ?? "") === expectedAuthor
          );
        });
        if (sharedHit) {
          factsheetId = sharedHit.id;
        }
      }
    }
  }

  // 3. 증거 조립: 팩트시트 entries + 메타 + 인용 URL 원문
  const evidence: { id: string; label: string; text: string }[] = [];
  if (factsheetId) {
    const { data: fs } = await supabase
      .from("factsheets")
      .select("toc, intro")
      .eq("id", factsheetId)
      .maybeSingle();
    if (fs && (fs.toc || fs.intro)) {
      const metaText = [
        fs.toc ? `목차:\n${fs.toc}` : "",
        fs.intro ? `소개:\n${fs.intro}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, AUTH_META_TEXT_MAX);
      evidence.push({ id: "meta", label: "도서 메타(목차·소개)", text: metaText });
    }
    const { data: entries } = await supabase
      .from("factsheet_entries")
      .select("id, chapter_label, content")
      .eq("factsheet_id", factsheetId)
      .limit(AUTH_ENTRY_MAX);
    for (const e of entries ?? []) {
      evidence.push({
        id: e.id,
        label: e.chapter_label,
        text: e.content.slice(0, AUTH_ENTRY_TEXT_MAX),
      });
    }
  }
  for (const url of urls.slice(0, AUTH_URL_FETCH_MAX)) {
    try {
      const text = await fetchPageText(url);
      if (text.trim()) {
        evidence.push({ id: url, label: "인용 URL", text: text.slice(0, AUTH_URL_TEXT_MAX) });
      }
    } catch {
      // 그 URL만 제외
    }
  }

  const head = claim.kind === "book" && claim.title
    ? `『${claim.title}』`
    : urls.length > 0
      ? "URL 인용"
      : "출처";

  // 증거가 하나도 없으면 LLM 없이 판정 불가.
  if (evidence.length === 0) {
    const existingAuth = (sub.authenticity as Record<string, unknown>) || {};
    const updatedAuth = mergeAuthenticity(existingAuth, {
      findings: [],
      factsheet_id: factsheetId,
      model: null,
      checked_at: checkedAt,
    });
    const save = await saveAuthenticity(admin, submissionId, projectId, "unverifiable", updatedAuth, factsheetId);
    if (!save.ok) return { ok: false, message: (save.message ?? "저장 실패").slice(0, 300) };
    return {
      ok: true,
      message: `${head} — 판정 불가(근거 확보 실패)`,
      status: "unverifiable",
    };
  }

  // 대조: 제출물이 출처에 대해 주장하는 내용을 뽑아 각 주장을 증거와 맞춘다.
  let findings: Finding[];
  let model: string;
  try {
    const res = await callLLM({
      userId,
      purpose: "검증",
      modelRouting: routing,
      temperature: 0,
      messages: [{ role: "user", content: buildComparePrompt(content, evidence) }],
    });
    findings = parseFindings(res.text, new Set(evidence.map((e) => e.id)));
    model = res.model;
  } catch (e) {
    const isRetryable =
      e instanceof Error &&
      ("status" in e) &&
      (e.status === 429 || e.status === 503 || e.status === 529);
    return {
      ok: false,
      message: (e instanceof Error ? e.message : "대조 호출 실패").slice(0, 300),
      retryable: isRetryable,
    };
  }

  const status = summarizeVerdict(findings);
  const supported = findings.filter((f) => f.verdict === "supported").length;
  const contradicted = findings.filter((f) => f.verdict === "contradicted").length;

  const existingAuth = (sub.authenticity as Record<string, unknown>) || {};
  const updatedAuth = mergeAuthenticity(existingAuth, {
    findings,
    factsheet_id: factsheetId,
    model,
    checked_at: checkedAt,
  });
  const save = await saveAuthenticity(admin, submissionId, projectId, status, updatedAuth, factsheetId);
  if (!save.ok) return { ok: false, message: (save.message ?? "저장 실패").slice(0, 300) };

  const verdictMsg =
    status === "verified"
      ? `확인(근거 ${supported})`
      : status === "suspect"
        ? `의심(모순 ${contradicted}건)`
        : "판정 불가(근거 부족)";
  return { ok: true, message: `${head} — ${verdictMsg}`, status };
}

// 진실성 상태·근거를 service role로 저장(채점처럼 — 소유자 update 정책 불변, needs_recalc 무관).
async function saveAuthenticity(
  admin: Admin,
  submissionId: string,
  projectId: string,
  status: AuthenticityStatus,
  authenticity: Record<string, unknown>,
  factsheetId: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await admin
    .from("submissions")
    .update({
      authenticity_status: status,
      authenticity,
      factsheet_id: factsheetId,
    })
    .eq("id", submissionId)
    .eq("project_id", projectId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// ── 재계산만(재채점 없이 합성·표시 점수·순위·등급) ──────────────────────
export async function recalculate(projectId: string): Promise<RecomputeResult> {
  const { supabase } = await requireProjectOwner(projectId);
  const admin = createAdminClient();
  const result = await recomputeAndSave(projectId, supabase, admin);
  revalidatePath(`/projects/${projectId}`);
  return result;
}

// ── 교사 보정 override (사유 필수, 감사 로그, 재계산) ────────────────────
export async function setScoreOverride(
  projectId: string,
  studentId: string,
  value: number,
  reason: string,
) {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error("보정 사유를 입력하세요."); // 수용 4
  // 표시 점수 스케일과 일치: 0~999 정수(2026-07-12 점수 체계 전환).
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    throw new Error("보정 점수는 0~999 정수입니다.");
  }

  const { error } = await supabase
    .from("students")
    .update({ score_override: value, override_reason: cleanReason })
    .eq("id", studentId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId: userId,
    action: "score_override.set",
    entity: "students",
    entityId: studentId,
    detail: { project_id: projectId, value, reason: cleanReason },
  });

  const admin = createAdminClient();
  await recomputeAndSave(projectId, supabase, admin);
  revalidatePath(`/projects/${projectId}`);
}

export async function clearScoreOverride(projectId: string, studentId: string) {
  const { userId, supabase } = await requireProjectOwner(projectId);
  const { error } = await supabase
    .from("students")
    .update({ score_override: null, override_reason: null })
    .eq("id", studentId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  await writeAuditLog({
    actorId: userId,
    action: "score_override.clear",
    entity: "students",
    entityId: studentId,
    detail: { project_id: projectId },
  });

  const admin = createAdminClient();
  await recomputeAndSave(projectId, supabase, admin);
  revalidatePath(`/projects/${projectId}`);
}

// ── 등급제 토글 저장(파생 표시라 재계산 불필요) ─────────────────────────
export async function updateGradingScheme(
  projectId: string,
  scheme: GradingScheme,
) {
  const { supabase } = await requireProjectOwner(projectId);
  if (!GRADING_SCHEMES.includes(scheme)) {
    throw new Error("등급제 값이 올바르지 않습니다.");
  }
  const { error } = await supabase
    .from("projects")
    .update({ grading_scheme: scheme })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
}

// ── 용도별 model_routing 편집(세션 4 이월) ─────────────────────────────
export async function updateModelRouting(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { supabase } = await requireProjectOwner(projectId);

  const { data: providers } = await supabase.from("providers").select("id");
  const validIds = new Set((providers ?? []).map((p) => p.id));

  // 4키만 재조립하면 배치 5의 default·배치 7의 rubric 키가 저장 때마다 소실된다 → 기존 라우팅을 보존.
  const { data: current } = await supabase
    .from("projects")
    .select("model_routing")
    .eq("id", projectId)
    .single();
  const routing: ModelRouting = { ...(current?.model_routing as ModelRouting) };
  for (const key of ROUTING_KEYS) {
    const providerId = String(formData.get(`${key}_provider`) ?? "").trim();
    const model = String(formData.get(`${key}_model`) ?? "").trim();
    if (!validIds.has(providerId)) {
      throw new Error(`'${key}' 프로바이더 선택이 올바르지 않습니다.`);
    }
    if (!model) throw new Error(`'${key}' 모델을 입력하세요.`);
    routing[key] = { provider_id: providerId, model };
  }

  const { error } = await supabase
    .from("projects")
    .update({ model_routing: routing })
    .eq("id", projectId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/settings`);
}
