-- 999점 표시 점수 체계 (리팩토링 2 배치 2, SPEC 6절 개정 예정)
alter table public.student_scores add column display_score integer;
comment on column public.student_scores.display_score is
  '999점 만점 표시 점수. 초기 확정 인원 채점 후 800~200 스프레드로 배정, 이후 중간 삽입. 재계산에도 유지(sticky).';
-- 점수 스케일이 바뀌므로 구(루브릭 합산) 스케일의 보정값은 초기화한다.
update public.students set score_override = null, override_reason = null where score_override is not null;
