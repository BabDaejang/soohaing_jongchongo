import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// 프로젝트 홈 — 처음 쓰는 교사도 흐름을 알 수 있도록 준비 단계 + Phase 1/2/3 안내 (SPEC 4~8절).
export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS로 본인 소유(또는 admin)만 조회된다. 없으면 접근 불가 → 404.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <header className="mb-8">
        <Link
          href="/"
          className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 프로젝트 목록
        </Link>
        <h1 className="mt-3 text-2xl font-bold">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-zinc-500">{project.description}</p>
        )}
      </header>

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">준비</h2>
        <p className="mb-3 text-sm text-zinc-500">
          평가를 시작하기 전에 평가 규칙과 학생 명단을 갖춥니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <SetupCard
            href={`/projects/${project.id}/settings`}
            title="설정"
            desc="등급제·글자수·합성 방식·동점자·원본 삭제 정책"
          />
          <SetupCard
            href={`/projects/${project.id}/rubric`}
            title="평가 루브릭"
            desc="채점 기준·배점·가중치 편집"
          />
          <SetupCard
            href={`/projects/${project.id}/students`}
            title="학생 명단"
            desc="학생 추가·수정, 교사 관찰 메모"
          />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">평가 흐름</h2>
        <p className="mb-3 text-sm text-zinc-500">
          준비가 끝나면 아래 세 단계를 순서대로 진행합니다. (각 단계는 이후
          업데이트에서 제공됩니다.)
        </p>
        <ol className="flex flex-col gap-3">
          <PhaseCard
            step={1}
            title="Phase 1 · 수합"
            desc="학생 산출물(엑셀·문서·PDF·이미지)을 업로드하면 텍스트를 추출합니다. 학번 매칭·확인 큐는 다음 단계에서 확정합니다."
            href={`/projects/${project.id}/ingest`}
          />
          <PhaseCard
            step={2}
            title="Phase 2 · 평가"
            desc="루브릭 기준으로 제출물을 채점하고, 합성 점수·순위·상대평가 등급을 파생합니다. 등급은 직접 수정하지 않고 점수에서 계산됩니다."
          />
          <PhaseCard
            step={3}
            title="Phase 3 · 생기부"
            desc="학생별로 산출물과 관찰 메모에 근거한 생기부를 생성하고, 근거 없는 문장을 검증·표시합니다. 학생 한 명씩 격리 생성됩니다."
          />
        </ol>
      </section>
    </main>
  );
}

function SetupCard({
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
      className="flex flex-col rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
    >
      <span className="font-medium">{title}</span>
      <span className="mt-1 text-xs text-zinc-500">{desc}</span>
    </Link>
  );
}

function PhaseCard({
  step,
  title,
  desc,
  href,
}: {
  step: number;
  title: string;
  desc: string;
  href?: string;
}) {
  const inner = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-500 dark:bg-zinc-800">
        {step}
      </span>
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs ${
              href
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
            }`}
          >
            {href ? "이용 가능" : "준비 중"}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">{desc}</p>
      </div>
    </>
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          className="flex gap-4 rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li className="flex gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {inner}
    </li>
  );
}
