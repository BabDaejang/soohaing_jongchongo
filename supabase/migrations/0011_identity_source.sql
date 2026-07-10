-- 0011_identity_source.sql — 매칭 식별값의 출처 기록
-- 근거: docs/SPEC.md 5.2(개정), docs/DATA_MODEL.md 8절
--
-- 자동 귀속 범위를 넓히면(이름 유일 일치·파일명·LLM 유래) 교사가 "무엇이 어떻게 자동
-- 처리됐는지" 훑어볼 수 있어야 한다. match_method(어떻게 매칭됐나)와 별개로
-- identity_source(학번·이름을 어디서 얻었나)를 남긴다.
--
--   column   — 스프레드시트의 학번/이름 열 (교사가 열 매핑에서 확정)
--   filename — 개별 파일의 파일명을 학생 명단과 교차 대조해 얻음
--   llm      — 문서 내용에서 저비용 모델이 추출
--
-- match_method는 0005에서 check 제약 없이 도입됐으므로 값 추가에 DDL이 필요 없다.
-- 0011에서 추가되는 값: auto_name(이름 유일 일치), reassigned(교사가 다른 학생으로 이동).

alter table public.submissions
  add column identity_source text
    check (identity_source in ('column', 'filename', 'llm'));

-- 백필: 0011 이전에 raw_student_no/raw_student_name이 채워진 행은 전부 스프레드시트 열 유래다
-- (개별 파일 업로드는 두 값을 NULL로 넣었다 — ingest/actions.ts).
update public.submissions
   set identity_source = 'column'
 where identity_source is null
   and (raw_student_no is not null or raw_student_name is not null);

comment on column public.submissions.identity_source is
  '매칭에 쓴 학번·이름의 출처: column | filename | llm (SPEC 5.2)';
