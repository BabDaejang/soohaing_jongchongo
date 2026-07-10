-- 0010_api_key_models.sql — 키별 모델 목록 저장
-- 근거: docs/SPEC.md 3절(키 검증·모델 목록·모델 라우팅), docs/DATA_MODEL.md 4절
-- 모델 목록은 프로바이더가 아니라 키에 종속된다 — 같은 프로바이더라도 키(조직·요금제)에 따라
-- 접근 가능한 모델이 다르다. 키 등록 시 조회해 저장하고 [모델 갱신]으로 재조회한다.

alter table public.api_keys
  add column models jsonb not null default '[]'::jsonb,
  add column models_synced_at timestamptz;

-- 기존 행(0010 이전에 등록된 키)은 models가 빈 배열이다. 화면은 이 경우 정적 카탈로그로
-- 폴백하고 [모델 갱신]을 안내한다. 백필하려면 각 키의 평문이 필요하므로 SQL로는 채울 수 없다.

comment on column public.api_keys.models is
  '이 키로 조회한 모델 ID 문자열 배열. 평문 키는 포함하지 않는다 (INV-4).';
