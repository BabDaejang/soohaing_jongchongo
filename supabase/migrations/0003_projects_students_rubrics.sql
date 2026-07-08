-- 0003_projects_students_rubrics.sql — 세션 4: 프로젝트·학생·루브릭 기초
-- 근거: docs/DATA_MODEL.md 5절(projects)·6절(rubrics)·7절(students), docs/SPEC.md 4절
-- 재사용: 0001의 set_updated_at()·is_admin()·is_approved().
-- 이번 세션 범위 컬럼만 생성한다 — Phase 2 전용 컬럼(projects.needs_recalc,
-- students.score_override·override_reason)은 세션 7 마이그레이션에서 추가 (DECISIONS 2026-07-08).

-- ============================================================
-- 5. projects — 수행평가 단위 (DATA_MODEL 5절)
-- ============================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,                                                    -- 프로젝트 설명(선택)
  grading_scheme text not null default 'grade5' check (grading_scheme in ('grade5', 'grade9')),
  char_limit integer not null default 500,
  count_method text not null default 'chars' check (count_method in ('chars', 'bytes')),
  score_aggregation text not null default 'avg' check (score_aggregation in ('sum', 'avg', 'weighted')),
  tie_break text not null default 'best_grade' check (tie_break in ('best_grade', 'mid_rank')),
  file_retention_days integer check (file_retention_days is null or file_retention_days in (7, 30)),
  -- model_routing: SQL default 없음. createProject가 buildDefaultModelRouting()으로 조립해 삽입한다.
  -- (컬럼 default는 providers 시드 id를 서브쿼리로 참조할 수 없음 — DECISIONS 2026-07-08)
  model_routing jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- 프로젝트 소유 판별 헬퍼 (DATA_MODEL 공통 규약). security definer로 students/rubrics 정책이
-- projects를 재조회할 때 정책 재귀를 피한다 (is_admin/is_approved와 동일 패턴).
create or replace function public.owns_project(p_project_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.projects
    where id = p_project_id and owner_id = (select auth.uid())
  );
$$;

-- RLS: 소유자 CRUD(+승인). admin은 전체 select(전체 열람). 교사 간 공유 없음.
alter table public.projects enable row level security;

create policy projects_select
  on public.projects for select
  to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());

create policy projects_insert
  on public.projects for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and public.is_approved());

create policy projects_update
  on public.projects for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.is_approved());

create policy projects_delete
  on public.projects for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- ============================================================
-- 6. rubrics — 평가 루브릭 (DATA_MODEL 6절)
-- ============================================================
create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  criteria jsonb not null,           -- [{id, name, description, max_score, weight}]
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  unique (project_id)                -- 프로젝트당 1행
);

create trigger rubrics_set_updated_at
  before update on public.rubrics
  for each row execute function public.set_updated_at();

-- RLS: 프로젝트 소유자 CRUD(+승인), admin select.
alter table public.rubrics enable row level security;

create policy rubrics_select
  on public.rubrics for select
  to authenticated
  using (public.owns_project(project_id) or public.is_admin());

create policy rubrics_insert
  on public.rubrics for insert
  to authenticated
  with check (public.owns_project(project_id) and public.is_approved());

create policy rubrics_update
  on public.rubrics for update
  to authenticated
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id) and public.is_approved());

create policy rubrics_delete
  on public.rubrics for delete
  to authenticated
  using (public.owns_project(project_id));

-- ============================================================
-- 7. students — 학생 (프로젝트 종속, DATA_MODEL 7절)
-- ============================================================
create table public.students (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  student_number text,               -- 학번(선택). 아래 partial unique로 프로젝트 내 중복 방지
  name text not null,
  teacher_memo text,                 -- 교사 개인 관찰 메모 (SPEC 7.4)
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- 학번은 프로젝트 내 유일(NULL은 제외 — 학번 미입력 학생 다수 허용)
create unique index students_project_number_uniq
  on public.students (project_id, student_number)
  where student_number is not null;

create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

-- RLS: 프로젝트 소유자 CRUD(+승인), admin select.
alter table public.students enable row level security;

create policy students_select
  on public.students for select
  to authenticated
  using (public.owns_project(project_id) or public.is_admin());

create policy students_insert
  on public.students for insert
  to authenticated
  with check (public.owns_project(project_id) and public.is_approved());

create policy students_update
  on public.students for update
  to authenticated
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id) and public.is_approved());

create policy students_delete
  on public.students for delete
  to authenticated
  using (public.owns_project(project_id));
