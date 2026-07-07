# PROGRESS — 세션별 체크리스트

> 규칙: 각 세션 종료 시 반드시 이 파일을 갱신한다.
> 형식: 세션 번호 / 날짜 / 완료 항목(체크) / 미완·보류 항목과 사유 / 다음 세션 인계 사항.
> 세션 1~8 분할 설계 근거는 DECISIONS.md 2026-07-07 항목 참조.

## 세션 0 — 2026-07-07 (프로젝트 헌장) ✅ 완료

- [x] git 저장소 초기화 (`main` 브랜치), `.gitignore` 생성
- [x] `docs/SPEC.md` — 사용자 제공 명세(0~11절) 반영, 상태 `확정`
- [x] `docs/DATA_MODEL.md` — 14개 테이블 컬럼·제약·관계·RLS 방향 구체화
- [x] `CLAUDE.md` — 스택 확정, 디렉토리 계획, 코딩 규약, INV-1~6 요약
- [x] `docs/PROGRESS.md` — 세션 1~8 골격
- [x] `docs/DECISIONS.md` — 이번 세션 판단 기록
- [x] 전체 문서 커밋
- typecheck·build: **해당 없음** — 이 세션은 애플리케이션 코드를 작성하지 않음 (세션 0 제약)

### 다음 세션(1) 인계

- SPEC의 `[확인 필요]` 4건(합성 점수·동점자·글자수·자동 삭제 기본값)은 제안값으로 문서화됨. 사용자 이견 시 DECISIONS 기록 후 갱신.
- 세션 1 시작 시 Supabase 프로젝트 URL/anon key/service role key, Vercel 연결 여부를 사용자에게 요청할 것.

---

## 세션 1 — 2026-07-07 (스캐폴드 + 인증 + 가입 승인) ✅ 완료

> 구획 재편(DECISIONS 2026-07-07): 인증·승인 워크플로를 세션 1로 앞당기고, 마이그레이션은 profiles·app_settings만. 관리자 패널 UI는 세션 2로.

- [x] Next.js 16(App Router, TS strict) + Tailwind v4 프로젝트 생성, `.env.example` 작성, `typecheck` 스크립트 추가
- [x] Supabase 클라이언트 헬퍼(`lib/supabase/`) — client/server/admin(service role, server-only) 분리 + 수동 Database 타입
- [x] 마이그레이션 `0001_auth_foundation.sql`: profiles(가입 트리거 → pending 자동 생성), app_settings(+waiting_message 시드), is_admin/is_approved, RLS — 원격 적용·검증 완료 (`supabase db push --db-url`)
- [x] Google OAuth 로그인 (기본 스코프 email·profile만), `/auth/callback`(+ADMIN_EMAIL 멱등 승격), `/auth/signout`
- [x] `/login`·`/waiting`(waiting_message 렌더링)·`/`(자리표시자) 페이지
- [x] proxy.ts(Next 16의 middleware 규약): 비로그인→/login, pending·rejected→/waiting만, /admin은 admin만
- [x] 최초 관리자: `ADMIN_EMAIL=sorang84@gmail.com` 실계정 로그인으로 admin·approved 승격 확인
- [x] **수용 기준 검증**: AC1(실로그인 pending 생성 + 테스트 사용자로 /waiting 강제 확인), AC2(approved 변경 후 정상 진입), AC3(본인 행만 조회·app_settings 변조 차단·비인증 전면 차단), AC4(.env* gitignore, 커밋 내 시크릿 없음), typecheck·lint·build 통과
- 특이사항: 제공된 Supabase 프로젝트에 이전 앱 테이블 4종 존재 → 사용자 승인 후 drop (DECISIONS 참조)

### 다음 세션(2) 인계

- 관리자 패널 UI(사용자 승인/거부/삭제, waiting_message 편집)가 세션 2 본체. `/admin` 라우트 규칙은 proxy.ts에 이미 존재.
- rejected 사용자도 현재 /waiting과 동일 화면 — 별도 문구가 필요하면 세션 2에서 결정.
- 마이그레이션 이력은 supabase CLI(supabase_migrations)로 관리 중. 새 마이그레이션은 `supabase/migrations/`에 추가 후 `db push --db-url "$SUPABASE_DB_URL"`.
- DB 검증 스크립트는 devDependency `pg` 활용 (스크래치에서 실행, 저장소에 없음).

---

## 세션 2 — (예정) 관리자 패널

- [ ] 관리자 화면: 사용자 목록·승인/거부/삭제 (profiles admin RLS 활용)
- [ ] waiting_message 편집 UI (app_settings admin 쓰기)
- [ ] rejected 사용자 안내 문구 정책 결정
- [ ] **수용 기준**: admin이 아닌 계정은 /admin 접근·조작 불가(미들웨어+RLS 이중 확인), 승인/거부가 즉시 대기 화면에 반영

## 세션 3 — (예정) API 키 체계·모델 라우팅

- [ ] providers 관리 UI (admin): 시드 3종 표시, [+] 추가 (name, base_url, api_format)
- [ ] 기본 키 등록(admin) / 개인 키 등록·변경·삭제(사용자) — 개인 키 우선 해석
- [ ] AES-256-GCM 암복호화 모듈 (`lib/crypto/`, 서버 전용, env `APP_ENCRYPTION_KEY`)
- [ ] 화면 마스킹(끝 4자리), 평문 로그 금지 확인
- [ ] LLM 프로바이더 어댑터(`lib/llm/`) + 용도별 모델 라우팅 (기본값: 추출/매칭 haiku, 평가/생성/검증 sonnet)
- [ ] **수용 기준**: 키가 DB에 평문으로 존재하지 않음, 클라이언트 번들에 키 관련 코드 없음(INV-4), 라우팅 기본값 동작

## 세션 4 — (예정) 프로젝트·학생·루브릭 기초

- [ ] 프로젝트 목록/생성/수정/삭제 (로그인 후 첫 화면)
- [ ] 프로젝트 설정: 등급제 토글, 글자수 제한·카운트 방식, 합성 방식, 동점자 처리, 원본 삭제 정책, 모델 라우팅
- [ ] 루브릭 편집 UI (기준·배점·가중치)
- [ ] 학생 목록·수동 추가·수정·삭제, 교사 관찰 메모 입력 박스
- [ ] **수용 기준**: 프로젝트 CRUD 전체 동작, 타 사용자 프로젝트 접근 불가(RLS 검증)

## 세션 5 — (예정) Phase 1(a) 업로드·파싱·중복 감지

- [ ] 다중 파일 업로드 (xlsx/csv/docx/pdf/이미지) → Storage 임시 버킷
- [ ] 파싱 파이프라인(`lib/parsing/`): SheetJS·papaparse·mammoth·pdf 텍스트 + LLM 비전 OCR(스캔본)
- [ ] 스프레드시트 열 매핑 UI: LLM 헤더 초기 추천 → 교사 확정
- [ ] 재업로드 중복·변경 감지: (학생 식별값+제출물ID)+content_hash → 동일 스킵 / 변경 시 갱신 확인 큐 (자동 덮어쓰기 금지)
- [ ] **수용 기준**: 동일 시트 2회 업로드 시 중복 0건 생성, 내용 변경분은 update_pending으로만 대기

## 세션 6 — (예정) Phase 1(b) 매칭·확인 큐·원본 삭제

- [ ] 매칭 규칙 (a)~(d) 구현: 학번 일치만 자동, 나머지는 확인 대기 큐
- [ ] 확인 대기 큐 UI: LLM 후보 제안 표시 + 교사 확정, 신규 학생 확인 흐름
- [ ] 제출물 상세 화면: 목록·열람, 평가/생기부 반영 체크박스, 수정/삭제/수동 추가
- [ ] 추출 텍스트 품질 승인 → 원본 삭제 흐름 (INV-5), N일 자동 삭제 보조 정책
- [ ] **수용 기준**: 학번 없는 제출물이 자동 귀속되는 경로가 없음, 승인 전 원본 삭제 경로가 없음(INV-5)

## 세션 7 — (예정) Phase 2 평가 파이프라인

- [ ] 채점 실행 버튼 + "재계산 필요" 배지 (신규 제출물·체크박스 변경 감지)
- [ ] 제출물 단위 LLM 채점: 루브릭 기반, temperature 0, 기준별 근거 인용, 원문 감사 보관
- [ ] 합성 점수(합/평균/가중) → 순위 → 등급 파생 (5등급/9등급 누적 비율 매핑, 토글 즉시 반영)
- [ ] 동점자 처리 (상위 등급/중간석차), score_override(사유 필수 + 감사 로그) 경유 재계산
- [ ] **수용 기준**: 등급 직접 수정 경로 없음(INV-6), student_scores는 서버 배치만 씀, override에 사유 없으면 거부

## 세션 8 — (예정) Phase 3 생기부 + 결과 화면

> 분량이 크므로 필요 시 8a(생성·검증)/8b(프로필·결과 표)로 분할 가능.

- [ ] 생기부 생성: 학생 1명 = 호출 1회(INV-1), 서버가 student_id 필터로 컨텍스트 조립(INV-2), sources 저장(INV-3), 버전 관리
- [ ] 검증 패스: 문장 단위 근거 판정 → 미근거 문장 하이라이트, 삭제/수정/재생성 선택
- [ ] 프롬프트 프로필: 참고/금지 2패널(분할바), 계정 기본+프로젝트 오버라이드, 시드 문체 기본값
- [ ] 예시 생기부 인제스트: diff 제안 → 교사 승인 항목만 반영
- [ ] 글자수 카운터 (제한 대비 실시간, 글자수/바이트 토글)
- [ ] 결과 표: 4열, 열 너비 드래그, 셀 3모드(접기/전체/커스텀), 행·전체 토글, 레이아웃 DB 저장·복원
- [ ] **수용 기준**: 생성 호출 페이로드에 타 학생 데이터가 포함될 수 있는 코드 경로가 없음, 검증 결과가 records.verification에 저장됨
