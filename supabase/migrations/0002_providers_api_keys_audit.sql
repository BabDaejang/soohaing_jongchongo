-- 0002_providers_api_keys_audit.sql — 세션 2: API 키 체계 + 감사 로그
-- 근거: docs/DATA_MODEL.md 3절(providers)·4절(api_keys)·14절(audit_logs), docs/SPEC.md 3절
-- audit_logs는 DATA_MODEL 원계획상 후속 세션이나, 세션 2 수용 기준 4
-- (승인/거부/삭제가 audit_logs에 남음)를 위해 이 세션에서 함께 도입한다 (DECISIONS 2026-07-08).

-- ============================================================
-- 3. providers — LLM 프로바이더 (DATA_MODEL 3절)
-- ============================================================
create table public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_url text,
  api_format text not null check (api_format in ('anthropic', 'openai', 'google')),
  is_seed boolean not null default false,
  created_at timestamptz not null default now()
);

-- select: 승인된 사용자 전체(개인 키 등록 화면에서 프로바이더 목록 필요)
-- insert/update/delete: admin 전용. is_seed 행은 delete 불가.
alter table public.providers enable row level security;

create policy providers_select_approved
  on public.providers for select
  to authenticated
  using (public.is_approved());

create policy providers_insert_admin
  on public.providers for insert
  to authenticated
  with check (public.is_admin());

create policy providers_update_admin
  on public.providers for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy providers_delete_admin
  on public.providers for delete
  to authenticated
  using (public.is_admin() and is_seed = false);

-- 시드 3종 (SPEC 3절). base_url은 NULL — 어댑터의 기본 엔드포인트를 사용한다.
insert into public.providers (name, api_format, is_seed) values
  ('google', 'google', true),
  ('anthropic', 'anthropic', true),
  ('openai', 'openai', true);

-- ============================================================
-- 4. api_keys — 암호화된 API 키 (DATA_MODEL 4절, INV-4)
-- ============================================================
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete cascade,  -- NULL = 관리자 등록 기본 키
  encrypted_key text not null,   -- AES-256-GCM 암호문(iv·tag 포함). 평문·복호화는 서버 전용
  key_last4 text not null,       -- 마스킹 표시용 끝 4자리
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- 사용자당 프로바이더별 1키. 기본 키(owner_id NULL)도 프로바이더별 1키.
create unique index api_keys_owner_provider_uniq
  on public.api_keys (provider_id, owner_id)
  where owner_id is not null;
create unique index api_keys_default_provider_uniq
  on public.api_keys (provider_id)
  where owner_id is null;

create trigger api_keys_set_updated_at
  before update on public.api_keys
  for each row execute function public.set_updated_at();

-- RLS: 개인 키(owner=본인)는 본인만 CRUD. 기본 키(owner NULL)는 admin만 CRUD.
-- encrypted_key 컬럼은 클라이언트 쿼리에서 절대 select 하지 않는다(코드 규약).
-- 복호화는 서버(Server Action)에서만 수행한다.
alter table public.api_keys enable row level security;

create policy api_keys_select
  on public.api_keys for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (owner_id is null and public.is_admin())
  );

create policy api_keys_insert
  on public.api_keys for insert
  to authenticated
  with check (
    (owner_id = (select auth.uid()) and public.is_approved())
    or (owner_id is null and public.is_admin())
  );

create policy api_keys_update
  on public.api_keys for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (owner_id is null and public.is_admin())
  )
  with check (
    (owner_id = (select auth.uid()) and public.is_approved())
    or (owner_id is null and public.is_admin())
  );

create policy api_keys_delete
  on public.api_keys for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (owner_id is null and public.is_admin())
  );

-- ============================================================
-- 14. audit_logs — 감사 로그 (DATA_MODEL 14절, append-only)
-- ============================================================
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,          -- 예: profile.approve, profile.reject, profile.delete, api_key.set, api_key.delete
  entity text not null,          -- 대상 테이블명
  entity_id uuid,
  detail jsonb,                  -- 사유·변경 전후 값 (API 키 평문 절대 금지)
  created_at timestamptz not null default now()
);

-- insert 정책 없음 → authenticated는 insert 불가. 기록은 service role(서버)만.
-- select는 admin 전용(자기 프로젝트 소유자 select는 프로젝트 테이블 도입 후 세션에서 추가).
-- update/delete 정책 없음 → append-only.
alter table public.audit_logs enable row level security;

create policy audit_logs_select_admin
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());
