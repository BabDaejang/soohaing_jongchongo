-- 0001_auth_foundation.sql — 세션 1: 인증·가입 승인 기반
-- 근거: docs/DATA_MODEL.md 1절(profiles)·2절(app_settings), docs/SPEC.md 2절
-- 잔여 테이블(providers, api_keys, projects, ...)은 이후 세션 마이그레이션에서 작성한다.

-- ============================================================
-- 공용: updated_at 자동 갱신 트리거 함수
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 1. profiles — 사용자 프로필·승인 상태 (DATA_MODEL 1절)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'user' check (role in ('admin', 'user')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 최초 Google 로그인(= 가입) 시 profiles 자동 생성, status 기본 'pending' (SPEC 2절)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 권한 판별 헬퍼 (DATA_MODEL 공통 규약)
-- security definer: RLS 정책 안에서 profiles를 재조회할 때 정책 재귀를 피한다.
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.is_approved()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'approved'
  );
$$;

-- ============================================================
-- profiles RLS
--  - 본인 행 select (status 확인용)
--  - admin 전체 select/update/delete
--  - insert 정책 없음: 생성 경로는 auth 트리거(handle_new_user, definer)뿐
--  - 일반 사용자 update 정책 없음: role·status 자가 변경 차단
-- ============================================================
alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_admin
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy profiles_update_admin
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy profiles_delete_admin
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- ============================================================
-- 2. app_settings — 전역 설정 key-value (DATA_MODEL 2절)
-- ============================================================
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz,
  updated_by uuid references public.profiles (id)
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- select는 인증 사용자 전체: 대기 화면은 미승인(pending) 사용자도 읽어야 한다.
-- 쓰기는 admin 전용.
alter table public.app_settings enable row level security;

create policy app_settings_select_authenticated
  on public.app_settings for select
  to authenticated
  using (true);

create policy app_settings_insert_admin
  on public.app_settings for insert
  to authenticated
  with check (public.is_admin());

create policy app_settings_update_admin
  on public.app_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy app_settings_delete_admin
  on public.app_settings for delete
  to authenticated
  using (public.is_admin());

-- 시드: 대기 화면 안내문 (관리자가 이후 편집 — 세션 2 UI)
insert into public.app_settings (key, value)
values (
  'waiting_message',
  to_jsonb('가입 신청이 접수되었습니다. 관리자 승인 후 이용할 수 있습니다.'::text)
);
