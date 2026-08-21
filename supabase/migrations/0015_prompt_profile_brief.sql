-- 0015_prompt_profile_brief.sql — 리팩토링 4 배치 5: 생기부 작성 브리프(MD)
-- 근거: docs/리팩토링_4.md P-7, docs/DATA_MODEL.md 12·12-1절.
--
-- 활동 맥락·강조 포인트는 프로젝트별 markdown 자유 서술(브리프)로 담는다. 새 테이블을 만들지
-- 않고 기존 prompt_profiles(+versions)에 컬럼만 더해 버전·이력·MD 입출력 기계를 그대로 탄다.
-- RLS 불변 — owner-only 기존 정책(행 단위)이 새 컬럼을 자동으로 포함한다.

alter table public.prompt_profiles add column brief_md text not null default '';
alter table public.prompt_profile_versions add column brief_md text not null default '';
