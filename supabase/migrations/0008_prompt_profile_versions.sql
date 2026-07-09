-- 0008_prompt_profile_versions.sql — 세션 8a 확장: 프롬프트 프로필 버전 번호·이력
-- 근거: 사용자 요청(2026-07-09) — 프로필 업데이트 시 버전·날짜시간 확인, 이력 열람·복원.
--       SPEC 7.5 확장(제품 의뢰자 승인) — DECISIONS 2026-07-09.
-- 재사용: 0001의 is_approved(), 0007의 prompt_profiles.
--
-- 설계: prompt_profiles(현재 상태, 단일 (owner,project) 행)에 version을 두고,
--   저장/예시반영/가져오기/복원 시 version을 증가하며 prompt_profile_versions에 스냅샷을 남긴다(append-only).
--   복원은 과거 스냅샷의 항목을 새 버전으로 저장(이력 삭제 없음).

alter table public.prompt_profiles add column version integer not null default 1;

create table public.prompt_profile_versions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.prompt_profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,     -- RLS 단순화용 비정규화
  project_id uuid references public.projects (id) on delete cascade,            -- NULL = 계정 기본
  version integer not null,
  guidelines jsonb not null,
  prohibitions jsonb not null,
  source text not null check (source in ('seed', 'edit', 'ingest', 'import', 'restore')),
  created_at timestamptz not null default now(),
  unique (profile_id, version)
);

create index prompt_profile_versions_profile_idx
  on public.prompt_profile_versions (profile_id);

-- RLS: 본인 프로필 이력만. append-only(update/delete 정책 없음).
alter table public.prompt_profile_versions enable row level security;

create policy ppv_select
  on public.prompt_profile_versions for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy ppv_insert
  on public.prompt_profile_versions for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and public.is_approved());
