-- 0013_factsheets_authenticity.sql — 리팩토링 2 배치 8: 도서팩트시트 + 제출물 진실성
-- 근거: docs/리팩토링_2.md 배치 8, docs/DATA_MODEL.md 15·15-1절(factsheets·factsheet_entries)·8절(submissions 진실성 3컬럼).
-- 재사용: 0001의 set_updated_at()·is_admin()·is_approved().
--
-- 무할루시네이션 원칙(배치 8~11): 메타(toc·intro)는 알라딘 원본 LLM 비경유 저장,
--   챕터별 사실(entries)은 수집 원문 스니펫 대조를 통과한 것만(배치 9 filterBySnippetMatch).
-- 공유 모델: private → pending_review(신청) → shared(관리자 승인, 전 계정 읽기 전용) / rejected.
--   교사는 자기 것을 shared·rejected로 전이할 수 없다(관리자만) — RLS with check로 강제.
-- 이 배치가 스키마를 일괄 확정한다(이후 배치 9~11은 스키마 불변).

-- ============================================================
-- 15. factsheets — 도서팩트시트 (DATA_MODEL 15절)
-- ============================================================
create table public.factsheets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  isbn13 text,
  title text not null,
  author text,
  publisher text,
  pub_year text,
  toc text,          -- 알라딘 목차 원본(HTML 제거) — LLM 비경유
  intro text,        -- 책 소개 원본 — LLM 비경유
  cover_url text,
  share_status text not null default 'private'
    check (share_status in ('private','pending_review','shared','rejected')),
  review jsonb,      -- 관리자 AI 엄격 검증 리포트(배치 11)
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  forked_from uuid references public.factsheets(id) on delete set null, -- shared 복제 출처
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index factsheets_owner_isbn on public.factsheets(owner_id, isbn13) where isbn13 is not null;
create index factsheets_owner_idx on public.factsheets(owner_id);
create index factsheets_shared_idx on public.factsheets(share_status) where share_status = 'shared';

create trigger factsheets_set_updated_at
  before update on public.factsheets
  for each row execute function public.set_updated_at();

create table public.factsheet_entries (
  id uuid primary key default gen_random_uuid(),
  factsheet_id uuid not null references public.factsheets(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade, -- RLS 단순화 비정규화
  chapter_label text not null default '전체',   -- 예: '3장', 'p.120-135'
  content text not null,                        -- 사실 서술(수집 원문 근거)
  quote text,                                   -- 원문 발췌 스니펫(서버 대조 통과분). user_manual은 null 허용
  source_url text,                              -- user_upload/user_manual이면 null
  source_type text not null
    check (source_type in ('aladin','naver_book','naver_blog','naver_news','web','user_upload','user_manual')),
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (factsheet_id, content_hash)           -- 보강 중복 누적 방지
);
create index factsheet_entries_factsheet_idx on public.factsheet_entries(factsheet_id);

-- ============================================================
-- RLS 헬퍼 (SECURITY DEFINER — is_admin/is_approved 패턴, search_path='')
-- ============================================================
create or replace function public.can_read_factsheet(p_factsheet_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.factsheets f
    where f.id = p_factsheet_id
      and (
        f.owner_id = (select auth.uid())
        or f.share_status = 'shared'
        or public.is_admin()
      )
  );
$$;

create or replace function public.can_edit_factsheet(p_factsheet_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.factsheets f
    where f.id = p_factsheet_id
      and (
        (f.owner_id = (select auth.uid()) and f.share_status <> 'shared' and public.is_approved())
        or public.is_admin()
      )
  );
$$;

-- ============================================================
-- factsheets RLS
--   select = owner or shared or admin
--   insert = owner and 승인
--   update = using(owner and share_status<>shared) or admin
--            with check(owner면 share_status in (private,pending_review); admin 무제한)
--   delete = (owner and share_status<>shared) or admin
-- ============================================================
alter table public.factsheets enable row level security;

create policy factsheets_select
  on public.factsheets for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or share_status = 'shared'
    or public.is_admin()
  );

create policy factsheets_insert
  on public.factsheets for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and public.is_approved());

create policy factsheets_update
  on public.factsheets for update
  to authenticated
  using (
    (owner_id = (select auth.uid()) and share_status <> 'shared')
    or public.is_admin()
  )
  with check (
    (owner_id = (select auth.uid()) and share_status in ('private','pending_review'))
    or public.is_admin()
  );

create policy factsheets_delete
  on public.factsheets for delete
  to authenticated
  using (
    (owner_id = (select auth.uid()) and share_status <> 'shared')
    or public.is_admin()
  );

-- ============================================================
-- factsheet_entries RLS
--   select = can_read_factsheet / insert·update·delete = can_edit_factsheet
--   (shared 팩트시트는 교사에게 완전 읽기 전용 — 보강하려면 복제)
-- ============================================================
alter table public.factsheet_entries enable row level security;

create policy factsheet_entries_select
  on public.factsheet_entries for select
  to authenticated
  using (public.can_read_factsheet(factsheet_id));

create policy factsheet_entries_insert
  on public.factsheet_entries for insert
  to authenticated
  with check (public.can_edit_factsheet(factsheet_id));

create policy factsheet_entries_update
  on public.factsheet_entries for update
  to authenticated
  using (public.can_edit_factsheet(factsheet_id))
  with check (public.can_edit_factsheet(factsheet_id));

create policy factsheet_entries_delete
  on public.factsheet_entries for delete
  to authenticated
  using (public.can_edit_factsheet(factsheet_id));

-- ============================================================
-- 8. submissions — 진실성 3컬럼 (DATA_MODEL 8절, 배치 10이 소비)
-- ============================================================
alter table public.submissions
  add column authenticity_status text not null default 'unverified'
    check (authenticity_status in ('unverified','not_applicable','verified','suspect','unverifiable')),
  add column authenticity jsonb,
  add column factsheet_id uuid references public.factsheets(id) on delete set null;
