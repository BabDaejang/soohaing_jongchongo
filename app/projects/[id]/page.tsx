import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assembleWorksheetRows } from "@/lib/worksheet/assemble";
import { listRoutableProviders } from "@/lib/llm/available";
import { WorksheetTable } from "@/components/projects/worksheet/worksheet-table";
import { PhaseSection } from "@/components/projects/dashboard/phase-section";
import { DefaultModelPicker } from "@/components/projects/dashboard/default-model-picker";
import { Phase1Panel } from "@/components/projects/dashboard/phase1-panel";
import { Phase2Panel } from "@/components/projects/dashboard/phase2-panel";
import { Phase3Panel } from "@/components/projects/dashboard/phase3-panel";
import { listUploadedFiles } from "@/app/projects/[id]/ingest/actions";
import { PersonalKeys } from "@/components/account/personal-keys";
import type { ModelRouting } from "@/lib/llm/types";
import type { KeyStatus, Provider, RubricCriterion } from "@/lib/supabase/types";

// 프로젝트 대시보드 — 페이즈 0(준비)→1(수합)→2(평가)→3(생기부)이 수직으로 이어지는 단일
// 작업 화면 + 하단 작업결과표 (리팩토링 2 배치 5, SPEC 4~8절). 페이즈 1~3 실행 UI는 배치 6·7.
export const maxDuration = 120;

export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS로 본인 소유(또는 admin)만 조회된다. 없으면 접근 불가 → 404.
  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, description, count_method, model_routing, needs_recalc, grading_scheme, tie_break",
    )
    .eq("id", id)
    .maybeSingle();
  if (!project || !user) notFound();

  const routing = project.model_routing as ModelRouting;

  // 작업결과표 — 액션과 동일한 4쿼리 + 공용 조립 함수(중복 금지).
  // 페이즈 0 키 상태 + 확인 대기 배지 + PersonalKeys용 providers/개인 키도 함께 조회한다.
  const [
    wsStudents,
    wsSubs,
    wsScores,
    wsRecords,
    wsLayout,
    pendingRes,
    routable,
    providersRes,
    keysRes,
    uploadedFiles,
    rubricRes,
    matchedRes,
    evalRes,
    suspectRes,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id, student_number, name, teacher_memo, score_override, override_reason")
      .eq("project_id", id),
    supabase
      .from("submissions")
      .select("id, student_id, source_filename, submission_key, authenticity_status, content_text, source_type")
      .eq("project_id", id)
      .not("student_id", "is", null),
    supabase
      .from("student_scores")
      .select("student_id, display_score, grade, effective_score")
      .eq("project_id", id),
    supabase
      .from("records")
      .select("student_id, content, version")
      .eq("project_id", id)
      .eq("is_current", true),
    supabase.from("ui_layouts").select("layout").eq("project_id", id).maybeSingle(),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .in("match_status", ["pending_confirm", "update_pending"]),
    listRoutableProviders(user.id),
    supabase.from("providers").select("*").order("name"),
    supabase
      .from("api_keys")
      .select("provider_id, key_last4, models, models_synced_at")
      .eq("owner_id", user.id),
    listUploadedFiles(id),
    supabase.from("rubrics").select("criteria").eq("project_id", id).maybeSingle(),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("include_in_eval", true)
      .not("student_id", "is", null)
      .in("match_status", ["auto_matched", "confirmed"]),
    supabase
      .from("evaluations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("is_current", true),
    supabase
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .eq("authenticity_status", "suspect"),
  ]);

  const worksheetRows = assembleWorksheetRows({
    students: wsStudents.data ?? [],
    submissions: wsSubs.data ?? [],
    scores: wsScores.data ?? [],
    records: wsRecords.data ?? [],
  });

  const pendingCount = pendingRes.count ?? 0;

  // 페이즈 2 데이터: 루브릭 기준 개수·채점 대상/완료 수·확정 반영 점수(등급 분포용).
  const criteria = (rubricRes.data?.criteria ?? []) as RubricCriterion[];
  const matchedIncluded = matchedRes.count ?? 0;
  const scoredSubmissions = evalRes.count ?? 0;
  const suspectCount = suspectRes.count ?? 0;
  const effectiveScores = (wsScores.data ?? []).map((s) =>
    Number(s.effective_score),
  );
  // 평가 모델 배지: 라우팅의 evaluate 대상 + 프로바이더명.
  const evalTarget = routing.evaluate;
  const providerNameById = new Map(
    (providersRes.data ?? []).map((p) => [p.id, p.name]),
  );
  const evalProviderName =
    providerNameById.get(evalTarget?.provider_id ?? "") ?? "알 수 없음";
  const evalModel = evalTarget?.model ?? "미설정";

  // 페이즈 0 키 상태: keySource != null인 프로바이더가 있으면 "키 있음".
  const withKey = routable.filter((p) => p.keySource !== null);
  const hasKey = withKey.length > 0;

  // 키 없음일 때 인라인 등록에 쓸 providers·개인 키 (account/page.tsx 조립 방식 그대로).
  const providers: Provider[] = providersRes.data ?? [];
  const personalKeys: Record<string, KeyStatus> = {};
  for (const row of keysRes.data ?? []) {
    personalKeys[row.provider_id] = {
      last4: row.key_last4,
      models: row.models ?? [],
      syncedAt: row.models_synced_at,
    };
  }

  return (
    <main className="w-full flex-1 px-4 py-10 bg-grid-pattern">
      <header className="mx-auto mb-10 w-full max-w-4xl border-4 border-black bg-neo-secondary p-6 shadow-neo-md rotate-[-0.5deg]">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-bold border-2 border-black bg-white px-2.5 py-1 text-black shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer"
        >
          ← 프로젝트 목록
        </Link>
        <h1 className="mt-4 text-3xl font-black tracking-tight uppercase text-black">{project.name}</h1>
        {project.description && (
          <p className="mt-2 text-sm font-bold text-black/80">{project.description}</p>
        )}
      </header>

      {/* 페이즈 0 · 준비 */}
      <PhaseSection
        id="phase-0"
        step={0}
        title="준비"
        desc="API 키를 확인하고 기본 AI 모델을 정한 뒤 수합으로 진행합니다."
      >
        <div className="flex flex-col gap-4">
          {hasKey ? (
            <div className="flex flex-col gap-3 border-4 border-black bg-[#E8F5E9] p-5 shadow-neo-sm text-black">
              <p className="font-bold text-sm">
                ✅ API 키가 등록되어 있습니다 ({withKey.map((p) => p.name).join(", ")}) — 아래 기본 AI 모델을 확인하고 페이즈 1로 진행하세요.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {withKey.map((p) => (
                  <span
                    key={p.id}
                    className="border-2 border-black bg-white px-2 py-0.5 font-bold"
                  >
                    {p.name}: {p.keySource === "personal" ? "개인 키" : "기본 키"}
                  </span>
                ))}
                <Link
                  href="/account"
                  className="font-bold underline underline-offset-2 hover:text-neo-accent"
                >
                  키 관리 →
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="border-4 border-black bg-[#FFF9C4] p-5 shadow-neo-sm text-black font-bold text-sm">
                ⚠️ API 키가 없습니다. 아래에서 개인 키를 등록해야 AI 기능 (수합 OCR·평가·생기부)을 쓸 수 있습니다.
              </p>
              <PersonalKeys providers={providers} personalKeys={personalKeys} />
            </div>
          )}

          <DefaultModelPicker
            projectId={project.id}
            routing={routing}
            providers={routable}
          />

          <LinkCard
            href={`/projects/${project.id}/settings`}
            title="프로젝트 설정 →"
            desc="등급제·글자수·합성 방식·동점자·원본 삭제 정책·모델 라우팅 세부"
          />
        </div>
      </PhaseSection>

      {/* 페이즈 1 · 수합 */}
      <PhaseSection
        id="phase-1"
        step={1}
        title="수합"
        desc="학생 산출물(엑셀·문서·PDF·이미지)을 업로드하고 [수합 & 매칭]으로 텍스트 추출·학번 매칭을 실행합니다."
      >
        <Phase1Panel
          projectId={project.id}
          ownerId={user.id}
          providers={routable}
          extract={routing.extract}
          initialFiles={uploadedFiles}
          pendingCount={pendingCount}
        />
      </PhaseSection>

      {/* 페이즈 2 · 평가 */}
      <PhaseSection
        id="phase-2"
        step={2}
        title="평가"
        desc="루브릭 기준으로 채점하고 점수·순위·등급을 파생합니다. 등급은 점수에서 계산됩니다."
      >
        <Phase2Panel
          projectId={project.id}
          needsRecalc={project.needs_recalc}
          matchedIncluded={matchedIncluded}
          scoredSubmissions={scoredSubmissions}
          suspectCount={suspectCount}
          providerName={evalProviderName}
          model={evalModel}
          criteriaCount={criteria.length}
          gradingScheme={project.grading_scheme}
          tieBreak={project.tie_break}
          effectiveScores={effectiveScores}
        />
      </PhaseSection>

      {/* 페이즈 3 · 생기부 */}
      <PhaseSection
        id="phase-3"
        step={3}
        title="생기부"
        desc="학생별로 산출물·관찰 메모에 근거한 생기부를 생성하고 문장을 검증합니다. 학생 한 명씩 격리 생성됩니다."
      >
        <Phase3Panel
          projectId={project.id}
          routing={routing}
          providers={routable}
        />
      </PhaseSection>

      {/* 작업결과표 (전폭 full-bleed, 엑셀 시트형) */}
      <section
        id="worksheet"
        className="relative left-1/2 mt-12 w-screen -translate-x-1/2 scroll-mt-6 px-4"
      >
        <div className="mx-auto w-full max-w-[98vw]">
          <h2 className="mb-4 text-2xl font-black uppercase tracking-tight text-black border-b-4 border-black pb-2">
            작업결과표
          </h2>
          <WorksheetTable
            projectId={project.id}
            projectName={project.name}
            countMethod={project.count_method}
            initialRows={worksheetRows}
            initialLayout={wsLayout.data?.layout ?? null}
          />
        </div>
      </section>
    </main>
  );
}

function LinkCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col border-4 border-black bg-white p-5 shadow-neo-sm hover:-translate-y-0.5 hover:shadow-neo-md transition-all duration-200"
    >
      <span className="text-md font-black uppercase tracking-wide text-black">{title}</span>
      <span className="mt-1 text-xs font-bold text-black/70">{desc}</span>
    </Link>
  );
}
