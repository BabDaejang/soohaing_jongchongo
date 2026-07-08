-- 0004_submissions.sql — 세션 5: Phase 1(a) 제출물 스테이징 + Storage 임시 버킷
-- 근거: docs/DATA_MODEL.md 8절(submissions)·Storage절, docs/SPEC.md 5.1·5.3
-- 재사용: 0001의 set_updated_at(), 0003의 owns_project()·is_admin()·is_approved().
--
-- 이 세션은 파일을 파싱해 "제출물 후보"를 스테이징(student_id NULL, match_status='unmatched')하는
-- 데까지다. 학생 매칭은 세션 6. DB에는 추출·정제 텍스트(content_text)만 저장, 원본 바이너리는
-- Storage 임시 버킷(originals)에만 둔다(SPEC 5.3).
--
-- DATA_MODEL 대비 확장(세션 5, DECISIONS 2026-07-08):
--   · raw_student_no / raw_student_name 추가 — 세션 6 매칭에 필요한 원본 식별값 보존
--   · match_status에 'unmatched' 추가(기본값) — 매칭 전 스테이징 상태

-- ============================================================
-- 8. submissions — 제출물 (DATA_MODEL 8절)
-- ============================================================
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 매칭 확정 전 NULL. NULL이면 평가·생성 컨텍스트에서 무조건 제외(혼입 방지). 세션 6이 채운다.
  student_id uuid references public.students (id) on delete set null,
  raw_student_no text,       -- 업로드에서 추출한 원본 학번(매칭용, 세션 6)
  raw_student_name text,     -- 업로드에서 추출한 원본 이름(매칭용, 세션 6)
  submission_key text,       -- 제출물ID(시트 열 값) 또는 파일명 — 중복 감지 키의 일부
  source_filename text,      -- 원본 파일명(표시용)
  content_text text not null,   -- 추출·정제 텍스트 (DB엔 이것만 저장 — SPEC 5.3)
  content_hash text not null,   -- 정규화 텍스트 SHA-256 — 재업로드 중복·변경 감지
  source_type text not null check (
    source_type in ('xlsx', 'csv', 'docx', 'pdf_text', 'pdf_scan', 'image', 'manual')
  ),
  storage_path text,         -- originals 버킷 경로. 원본 삭제 후 NULL(INV-5는 세션 6)
  match_status text not null default 'unmatched' check (
    match_status in ('unmatched', 'auto_matched', 'pending_confirm', 'confirmed', 'update_pending')
  ),
  match_candidates jsonb,    -- 확인 대기 큐 후보(세션 6). 세션 5엔 NULL
  pending_content jsonb,     -- update_pending일 때 새 {content_text, content_hash} 보관(자동 덮어쓰기 금지)
  include_in_eval boolean not null default true,     -- 평가 반영 체크박스(SPEC 5.4)
  include_in_record boolean not null default true,   -- 생기부 반영 체크박스(SPEC 5.4)
  extraction_approved_at timestamptz,  -- 교사 추출 승인 시각. NULL이면 원본 삭제 금지(INV-5, 세션 6)
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

-- 중복 감지·매칭 조회용(하드 unique 제약은 두지 않는다 — update_pending 스테이징 허용)
create index submissions_project_key_idx on public.submissions (project_id, submission_key);
create index submissions_project_student_idx on public.submissions (project_id, student_id);

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

-- RLS: 프로젝트 소유자 CRUD(+승인), admin select. 세션 5는 소유자 세션 클라이언트로 쓴다.
alter table public.submissions enable row level security;

create policy submissions_select
  on public.submissions for select
  to authenticated
  using (public.owns_project(project_id) or public.is_admin());

create policy submissions_insert
  on public.submissions for insert
  to authenticated
  with check (public.owns_project(project_id) and public.is_approved());

create policy submissions_update
  on public.submissions for update
  to authenticated
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id) and public.is_approved());

create policy submissions_delete
  on public.submissions for delete
  to authenticated
  using (public.owns_project(project_id));

-- ============================================================
-- Storage: originals 버킷 (원본 파일 임시 보관, DATA_MODEL Storage절)
-- 경로: {owner_id}/{project_id}/{fileUuid}__{filename}
--   (스프레드시트는 1파일→다행이라 submission_id를 경로에 못 쓴다 — DECISIONS 2026-07-08)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('originals', 'originals', false)
on conflict (id) do nothing;

-- 경로 첫 세그먼트(owner_id) = auth.uid()인 소유자만 read/write.
-- (원본 삭제 조건 extraction_approved_at IS NOT NULL 강제는 세션 6에서 삭제 흐름과 함께.)
create policy originals_select_own
  on storage.objects for select
  to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy originals_insert_own
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy originals_update_own
  on storage.objects for update
  to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy originals_delete_own
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = (select auth.uid())::text);
