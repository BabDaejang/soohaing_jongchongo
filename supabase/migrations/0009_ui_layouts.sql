-- 0009_ui_layouts.sql — 세션 8b: Phase 3 결과 표 레이아웃 저장 (ui_layouts)
-- 근거: docs/SPEC.md 8절, docs/DATA_MODEL.md 13절.
-- 재사용: 0001의 is_approved(). 팩은 0007을 언급하나 0007·0008이 선점 → 0009 (PROGRESS 8b 인계·DECISIONS 2026-07-10).
--
-- 설계: (user_id, project_id)당 레이아웃 1행. layout jsonb에 열 너비·셀 표시 모드·커스텀 높이·전체 토글 상태.
--   저장은 디바운스 upsert(onConflict user_id,project_id), 프로젝트 재진입 시 복원.

create table public.ui_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  layout jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, project_id)
);

create index ui_layouts_project_idx on public.ui_layouts (project_id);

-- RLS: 본인(user_id) 레이아웃만 (DATA_MODEL 13절). 쓰기엔 is_approved() 추가(0008 ppv_insert 패턴).
alter table public.ui_layouts enable row level security;

create policy ui_layouts_select
  on public.ui_layouts for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy ui_layouts_insert
  on public.ui_layouts for insert
  to authenticated
  with check (user_id = (select auth.uid()) and public.is_approved());

create policy ui_layouts_update
  on public.ui_layouts for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_approved());

create policy ui_layouts_delete
  on public.ui_layouts for delete
  to authenticated
  using (user_id = (select auth.uid()));
