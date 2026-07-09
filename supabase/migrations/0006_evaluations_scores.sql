-- 0006_evaluations_scores.sql — 세션 7: Phase 2 상대평가 (채점·합성·순위·등급)
-- 근거: docs/SPEC.md 6절, docs/DATA_MODEL.md 5·7·9·10절, INV-6.
-- 재사용: 0001의 set_updated_at()·is_admin(), 0003의 owns_project().
--
-- 핵심 불변(INV-6): evaluations·student_scores 쓰기는 service role 배치 전용
--   (RLS에 select 정책만 두고 insert/update/delete 정책을 두지 않아 authenticated는 쓰기 불가).
--   교사 개입은 students.score_override(사유 필수)로만 — 등급 직접 저장·수정 경로 없음.

-- ============================================================
-- 7. students — 교사 개입 점수(override) 컬럼 추가 (DATA_MODEL 7절, 세션 4→7 이월)
-- ============================================================
alter table public.students add column score_override numeric;
alter table public.students add column override_reason text;

-- 사유 필수: 둘 다 NULL이거나 둘 다 NOT NULL (SPEC 6절, 수용 4)
alter table public.students add constraint students_override_reason_required
  check (
    (score_override is null and override_reason is null)
    or (score_override is not null and override_reason is not null)
  );

-- ============================================================
-- 5. projects — "재계산 필요" 배지 플래그 추가 (DATA_MODEL 5절, 세션 4→7 이월)
-- ============================================================
alter table public.projects add column needs_recalc boolean not null default false;

-- ============================================================
-- 9. evaluations — 제출물 단위 LLM 채점 (DATA_MODEL 9절)
-- ============================================================
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,  -- 조회 편의 + RLS
  scores jsonb not null,             -- [{criterion_id, score, evidence_quote}] — 근거 인용 필수
  total_score numeric not null,      -- 기준 점수 합산(루브릭 배점 기준)
  content_hash text not null,        -- 채점 당시 제출물 content_hash 스냅샷 — 증분 재평가 판정
  raw_llm_output text not null,      -- 감사용 LLM 원문
  model text not null,               -- 사용 모델 식별자
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

-- 제출물당 현재 평가 1행(재채점 시 이전 행 is_current=false로 내리고 새 행 insert)
create unique index evaluations_current_uniq
  on public.evaluations (submission_id)
  where is_current;

create index evaluations_project_idx on public.evaluations (project_id);
create index evaluations_submission_idx on public.evaluations (submission_id);

-- RLS: 소유자 select만. 쓰기 정책 없음 = service role 전용(INV-6).
alter table public.evaluations enable row level security;

create policy evaluations_select
  on public.evaluations for select
  to authenticated
  using (public.owns_project(project_id) or public.is_admin());

-- ============================================================
-- 10. student_scores — 학생별 합성 점수·순위·등급 스냅샷 (DATA_MODEL 10절, INV-6)
-- ============================================================
create table public.student_scores (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  composite_score numeric not null,  -- 합성 점수(합/평균/가중 — 프로젝트 설정)
  effective_score numeric not null,  -- coalesce(students.score_override, composite_score) 스냅샷
  rank integer not null,             -- 전체 순위(동점 처리 반영, 석차)
  grade integer not null,            -- 파생 등급(누적 비율 매핑 스냅샷)
  calculated_at timestamptz not null,
  unique (project_id, student_id)
);

create index student_scores_project_idx on public.student_scores (project_id);

-- RLS: 소유자 select만. 쓰기 정책 없음 = service role 재계산 배치 전용(INV-6).
alter table public.student_scores enable row level security;

create policy student_scores_select
  on public.student_scores for select
  to authenticated
  using (public.owns_project(project_id) or public.is_admin());

-- ============================================================
-- "재계산 필요" 트리거 (SPEC 6절) — 세션 5/6 액션 파일을 건드리지 않고 배지를 충족.
--   설정(true): 제출물 추가/삭제/내용·반영·귀속 변경, 루브릭 기준 변경.
--   해제(false): 서버 재계산 배치가 담당.
-- security definer로 projects update가 RLS 재귀·권한 문제 없이 수행된다.
-- ============================================================
create or replace function public.flag_project_needs_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid;
begin
  if tg_op = 'DELETE' then
    pid := old.project_id;
  else
    pid := new.project_id;
  end if;
  update public.projects set needs_recalc = true where id = pid;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger submissions_flag_recalc_ins
  after insert on public.submissions
  for each row execute function public.flag_project_needs_recalc();

create trigger submissions_flag_recalc_del
  after delete on public.submissions
  for each row execute function public.flag_project_needs_recalc();

-- 채점에 영향을 주는 변경만: 내용(content_hash)·반영 체크박스·귀속(student_id).
create trigger submissions_flag_recalc_upd
  after update on public.submissions
  for each row
  when (
    old.content_hash is distinct from new.content_hash
    or old.include_in_eval is distinct from new.include_in_eval
    or old.student_id is distinct from new.student_id
  )
  execute function public.flag_project_needs_recalc();

create trigger rubrics_flag_recalc_upd
  after update on public.rubrics
  for each row
  when (old.criteria is distinct from new.criteria)
  execute function public.flag_project_needs_recalc();
