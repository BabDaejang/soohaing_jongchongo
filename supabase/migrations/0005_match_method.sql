-- 0005_match_method.sql — 세션 6: 귀속 경로 기록 컬럼
-- 근거: docs/SPEC.md 5.2, 세션 6 지시("어떤 경로로 귀속됐는지 기록").
-- DATA_MODEL 8절 확장(DECISIONS 2026-07-08): submissions에 match_method 추가.
--
-- 값(nullable, 미귀속/대기 시 NULL):
--   auto_number       — (a) 기존 학생 학번 완전 일치, 자동 귀속
--   auto_new_number   — (d) 신규 학번 검출, 학생 자동 생성 후 귀속
--   confirmed_existing— 교사가 확인 큐에서 기존 학생으로 확정
--   confirmed_new     — 교사가 확인 큐에서 신규 학생 생성·확정
--   manual            — 교사가 수동으로 추가·귀속한 제출물

alter table public.submissions add column match_method text;
