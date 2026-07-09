-- 0007_records_profiles.sql — 세션 8a: Phase 3 생기부 생성·검증 (records·prompt_profiles)
-- 근거: docs/SPEC.md 7절, docs/DATA_MODEL.md 11절(records)·12절(prompt_profiles), INV-1/2/3.
-- 재사용: 0001의 set_updated_at()·is_admin()·is_approved(), 0003의 owns_project().
-- 팩은 0006을 언급하나 0006은 세션 7이 선점 → 0007 (DECISIONS 2026-07-09).
--
-- 핵심 불변:
--   INV-3: 생성 결과(generated) + verification 위조 차단 → generated 행 insert는 service role 전용
--          (RLS insert 정책은 origin in ('edited','manual')만 허용). 교사 편집·수동본만 소유자 세션이 쓴다.
--   INV-1/2는 서버 코드(buildStudentContext 단일 studentId, student_id 필터 조립)에서 강제한다.

-- ============================================================
-- 11. records — 생기부 (버전 관리, DATA_MODEL 11절)
-- ============================================================
create table public.records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,  -- 정확히 한 학생 (INV-1)
  version integer not null,
  content text not null,
  sources uuid[] not null,             -- 근거 제출물 id 목록 (INV-3). 수동 작성 버전은 빈 배열 허용
  teacher_memo_used boolean not null default false,  -- 생성 컨텍스트에 교사 메모 포함 여부(감사)
  verification jsonb,                  -- [{sentence, grounded, source_submission_ids, grounded_by_memo?}]
  model text,                          -- 생성 모델 (수동 편집 버전은 NULL)
  origin text not null check (origin in ('generated', 'edited', 'manual')),  -- 팩 edited_by_teacher = origin 'edited'
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id, version)
);

-- 학생당 현재 버전 1행 (새 버전 insert 전 이전 행 is_current=false로 내린다)
create unique index records_current_uniq
  on public.records (student_id)
  where is_current;

create index records_project_idx on public.records (project_id);
create index records_student_idx on public.records (student_id);

-- RLS: 소유자 select. generated/verification insert는 service role 전용(INV-3),
--      교사 편집(edited)·수동본(manual) insert는 소유자 허용. is_current 관리 update는 소유자.
alter table public.records enable row level security;

create policy records_select
  on public.records for select
  to authenticated
  using (public.owns_project(project_id) or public.is_admin());

-- generated는 정책에서 제외 → authenticated는 generated 행을 만들 수 없다(service role만).
create policy records_insert_teacher
  on public.records for insert
  to authenticated
  with check (
    public.owns_project(project_id)
    and public.is_approved()
    and origin in ('edited', 'manual')
  );

create policy records_update
  on public.records for update
  to authenticated
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id) and public.is_approved());

-- delete 정책 없음 — 버전 이력은 append-only(is_current=false로 대체).

-- ============================================================
-- 12. prompt_profiles — 프롬프트 프로필 (계정 기본 + 프로젝트 오버라이드, DATA_MODEL 12절)
-- ============================================================
create table public.prompt_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,   -- 계정별 관리
  project_id uuid references public.projects (id) on delete cascade,          -- NULL = 계정 기본
  guidelines jsonb not null default '[]',      -- 작성 참고사항: [{id, text}]
  prohibitions jsonb not null default '[]',    -- 금지사항: [{id, text}]
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- unique: 계정 기본(project_id NULL) 1행, 프로젝트별 오버라이드 1행 (partial unique 2개)
create unique index prompt_profiles_account_default_uniq
  on public.prompt_profiles (owner_id)
  where project_id is null;

create unique index prompt_profiles_project_override_uniq
  on public.prompt_profiles (owner_id, project_id)
  where project_id is not null;

create trigger prompt_profiles_set_updated_at
  before update on public.prompt_profiles
  for each row execute function public.set_updated_at();

-- RLS: 본인 프로필만 CRUD (owner_id = auth.uid()). 교사 본인 메타데이터.
alter table public.prompt_profiles enable row level security;

create policy prompt_profiles_select
  on public.prompt_profiles for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy prompt_profiles_insert
  on public.prompt_profiles for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and public.is_approved());

create policy prompt_profiles_update
  on public.prompt_profiles for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.is_approved());

create policy prompt_profiles_delete
  on public.prompt_profiles for delete
  to authenticated
  using (owner_id = (select auth.uid()));
