-- 0014_evaluations_origin.sql — 리팩토링 4 배치 4: 평가 교사 수정(origin='teacher')
-- 근거: docs/리팩토링_4.md P-3, docs/DATA_MODEL.md 9절.
--
-- 교사 수정은 update가 아니라 **새 행 insert**로 남긴다(records의 'edited' 버전 패턴과 동일).
-- LLM 원본 행은 그대로 보존되고, 이력에서 누가 매긴 점수인지 origin으로 구분된다.
--
-- RLS는 건드리지 않는다: evaluations는 여전히 select 정책만 있어 authenticated가 쓸 수 없고,
-- 교사 수정도 서버 액션의 service role(requireProjectOwner + 감사 로그)로만 기록된다(INV-6 주변 불변).

-- 채점 주체. 기존 행은 전부 LLM 산출물이므로 기본값 'llm'이 그대로 맞다.
alter table public.evaluations add column origin text not null default 'llm'
  check (origin in ('llm', 'teacher'));

-- 교사 수정 행에는 LLM 원문·모델이 존재하지 않는다 → not null 완화.
alter table public.evaluations alter column model drop not null;
alter table public.evaluations alter column raw_llm_output drop not null;

-- 다만 LLM 행은 여전히 원문·모델을 반드시 남겨야 한다(감사 추적성 유지).
alter table public.evaluations add constraint evaluations_llm_fields
  check (origin = 'teacher' or (model is not null and raw_llm_output is not null));
