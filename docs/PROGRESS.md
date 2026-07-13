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

## 세션 2 — 2026-07-08 (관리자 패널 + API 키 체계 + LLM 통합 클라이언트) ✅ 완료

> 범위 재편(DECISIONS 2026-07-08): 원 PROGRESS의 세션 2(관리자 패널) + 세션 3(API 키·crypto·LLM)을 사용자 세션 2 지시로 병합.

- [x] 마이그레이션 `0002_providers_api_keys_audit.sql`: providers(시드 google/anthropic/openai)·api_keys(암호문+last4, owner NULL=기본 키, partial unique)·audit_logs(append-only) + RLS — 원격 적용·검증 완료
- [x] `/admin` 패널: 계정 목록(상태 필터·승인/거부/삭제, audit 기록)·waiting_message 편집·프로바이더 관리([+] 추가)·프로바이더별 기본 키 등록/변경/삭제(끝 4자리 마스킹)
- [x] `/account` 계정 옵션: 개인 API 키 등록/변경/삭제(프로바이더별, 마스킹)
- [x] `lib/crypto/`: AES-256-GCM 암복호화(env `APP_ENCRYPTION_KEY`, server-only) + keyLast4
- [x] `lib/llm/`: resolveApiKey(개인>기본>명시적 에러, 서비스롤 조회+서버 복호화)·callLLM(purpose→모델 라우팅, anthropic/openai/google 어댑터로 형식 흡수)·전부 server-only
- [x] `lib/audit.ts`: 감사 로그 기록 헬퍼(service role, 평문 금지)
- [x] 단위 테스트(node:test + tsx): crypto 왕복·IV 무작위·변조 감지, resolveApiKey 개인>기본>에러 — `npm test` 7건 통과
- [x] **수용 기준 검증**: (1) api_keys에 평문 없음 — 마이그레이션엔 encrypted_key만, 라이브 DB e2e로 ciphertext≠plaintext 확인 / (2) 클라이언트 번들(.next/static)에 crypto·복호화·service role 키 문자열 없음(server-only 강제), 서버 번들엔 존재 / (3) 개인 키 우선 — 단위 테스트 + 라이브 e2e / (4) 승인/거부/삭제·키 set/delete가 audit_logs 기록 — 액션이 writeAuditLog 호출, service-role insert 경로 스모크 확인. typecheck·lint·build·test 모두 통과.
- 특이사항: rejected 사용자 안내 문구는 /waiting 공통 화면 유지(별도 문구 보류 — DECISIONS 참조). 관리자 패널 UI 접근은 proxy.ts(admin 가드) + 서버 액션 requireAdmin() + RLS 삼중 방어.

### 다음 세션(4) 인계

- 세션 2가 원 계획의 세션 2+3을 병합했으므로, 남은 세션 번호(4~8)는 그대로 유지된다. 다음은 **세션 4 — 프로젝트·학생·루브릭 기초**.
- 프로젝트 `model_routing` 기본값 조립 시 `lib/llm/routing.ts`의 `DEFAULT_MODELS`(추출/매칭=haiku, 평가/생성/검증=sonnet-4-6)와 시드 프로바이더 id를 결합할 것. callLLM은 이미 `{provider_id, model}` 라우팅을 인자로 받는다.
- 마이그레이션 새 파일은 `supabase/migrations/`에 추가 후 `db push --db-url "$SUPABASE_DB_URL"`. providers 시드 id는 이름(google/anthropic/openai)으로 조회.
- 서버 전용 모듈 테스트는 `--conditions=react-server` 필요(server-only). `npm test`가 이미 그 형태.

## 세션 4 — 2026-07-08 (프로젝트·학생·루브릭 기초) ✅ 완료

- [x] 마이그레이션 `0003_projects_students_rubrics.sql`: projects·rubrics·students + `owns_project()` SECURITY DEFINER 헬퍼 + RLS(소유자 CRUD·승인, admin select) — 원격 적용·pg 검증 완료. 하위 FK는 on delete cascade.
- [x] 프로젝트 목록/생성/수정/삭제 (로그인 후 첫 화면 `app/page.tsx` = `ProjectList`). 생성 시 model_routing 조립 + 기본 루브릭 시드.
- [x] 프로젝트 홈(`/projects/[id]`): 준비(설정·루브릭·학생) + Phase 1/2/3 흐름 안내 문구.
- [x] 프로젝트 설정(`/settings`): 등급제·글자수·카운트 방식·합성 방식·동점자·원본 삭제 정책 편집. 저장→재로드 왕복. (model_routing은 생성 시 기본 조립, 용도별 편집 UI는 실제 파이프라인 세션에서.)
- [x] 루브릭 편집(`/rubric`): 기준 CRUD(이름/설명/배점/가중치), 서버 재검증.
- [x] 학생 목록(`/students`): 수동 추가/수정/삭제(학번 중복 방지) + 학생별 교사 관찰 메모 자동 저장(디바운스, "저장됨" 표시).
- [x] `lib/llm/routing.ts`에 `buildDefaultModelRouting()` 추가(DEFAULT_MODELS + 조회한 anthropic provider_id), `lib/projects.ts`에 `requireProjectOwner()`(심층 방어).
- [x] proxy.ts: 기존 approved 게이트가 `/projects/*`를 approved 전용으로 강제함을 주석 명시(소유권은 RLS·액션·페이지에서 강제).
- [x] 단위 테스트 `tests/model-routing.test.ts` 추가 — `npm test` 9건 통과.
- [x] **수용 기준 검증**:
  (1) 프로젝트 생성→수정→삭제, 설정 저장/재로드 왕복 — 액션+SettingsForm 동작, build 통과.
  (2) 타 사용자 접근 차단 — 스크래치 pg 스크립트(미커밋)로 두 사용자 교차 접근 12건 검증: B의 A 프로젝트/학생/루브릭 select 0행, update/delete 0행, insert RLS 42501 차단, A는 자기 데이터 접근 가능.
  (3) 삭제 시 하위 cascade — FK on delete cascade 구현 + DECISIONS 기록.
  (4) model_routing 기본값 = DEFAULT_MODELS + 시드 provider id — buildDefaultModelRouting + 단위 테스트로 증명.
  (5) typecheck·lint·build·test 모두 통과.
- 특이사항: 세션 지시의 `student_no`는 DATA_MODEL의 `student_number`로 채택. description 컬럼 추가, model_routing은 앱 조립(SQL default 없음), Phase 2 전용 컬럼(needs_recalc/score_override/override_reason)은 세션 7로 연기 — 모두 DECISIONS 2026-07-08 기록.

### 다음 세션(5) 인계

- 세션 5 = Phase 1(a) 업로드·파싱·중복 감지. submissions 테이블 마이그레이션은 세션 5에서 작성.
- 프로젝트별 파일 파싱 시 `projects.model_routing.extract`(purpose='추출'/'매칭')로 `callLLM` 라우팅 인자를 넘길 것. routing은 `{provider_id, model}` 형태로 이미 저장됨.
- 학생 자동 생성은 "학번 신규 검출" 시에만(SPEC 5.2-d) — 세션 4는 수동 추가만 제공. 매칭·확인 큐는 세션 6.
- Storage 임시 버킷(`originals`)·정책은 아직 없음 — 세션 5에서 도입.
- **용도별 model_routing 편집 UI 미구현(기본값 자동 조립만)** — 후속 세션(추천 배치: 세션 7)에서 프로바이더·모델 선택 목록과 함께 구현 예정(DECISIONS 2026-07-08). `resolveApiKey`가 routing.provider_id로 키를 고르므로 비-anthropic 개인 키 교사를 위해 실질적으로 필요. 현재는 anthropic haiku/sonnet 기본값이 조립되어 파이프라인 동작에는 공백 없음.
- 새 마이그레이션은 `supabase/migrations/`에 추가 후 `db push --db-url "$SUPABASE_DB_URL"`. DB/RLS 검증은 devDependency `pg`로 스크래치에서 실행(저장소에 두지 않음).

## 세션 5 — 2026-07-08 (Phase 1(a) 업로드·파싱·중복 감지) ✅ 완료

- [x] 마이그레이션 `0004_submissions.sql`: submissions(스테이징 — student_id NULL·match_status='unmatched', raw_student_no/name 추가) + 조회 인덱스 + RLS(소유자 CRUD·admin select) + Storage `originals` 비공개 버킷·소유자 경로 정책 4종 — 원격 적용·pg 검증 완료.
- [x] 다중 파일 드래그앤드롭 업로드(xlsx/csv/docx/pdf/이미지) → 브라우저 클라이언트로 `originals`(RLS owner 경로) 업로드.
- [x] 파싱 파이프라인 `lib/parsing/`: parseXlsx(SheetJS)·parseCsv(papaparse)·parseDocx(mammoth)·parsePdfText(unpdf 텍스트레이어, 스캔 판정)·normalizeText/sha256Hex·decideDedup·fileKind.
- [x] 비전 OCR: `lib/llm` 확장(LLMMessage.content = string | 파트[], 어댑터 3종 image/document 매핑) + 스캔 PDF·이미지를 callLLM(purpose='추출')으로. **OCR 프로바이더·모델 선택기**(VISION_MODELS 카탈로그, model_routing.extract에 저장).
- [x] 스프레드시트 열 매핑 UI: 헤더 미리보기 + LLM 초기 추천(callLLM purpose='추출', 실패 시 휴리스틱 폴백) → 교사 확정 → 행 분해.
- [x] 재업로드 중복·변경 감지: (project, raw 식별값, submission_key)로 조회 → content_hash 동일 스킵 / 변경 시 match_status='update_pending' + pending_content(자동 덮어쓰기 금지).
- [x] 인제스트 화면(`/projects/[id]/ingest`), 프로젝트 홈 Phase 1 링크 활성화, 수합된 제출물 후보 목록.
- [x] 단위 테스트 5건 추가(parsing·dedup·vision-content) — `npm test` 19건 통과.
- [x] **수용 기준 검증**:
  (1) 4종 추출: xlsx/csv 왕복·pdf 텍스트레이어 추출은 단위 테스트로 확인(파서 임포트 시 mammoth/unpdf 로드 스모크 포함), 스캔 PDF·이미지 vision_ocr 경로는 유효 키가 있을 때 라이브 시연(비용 발생 — 관리자 기본 키 필요). callLLM 라우팅·비전 파트 매핑은 단위 테스트로 증명.
  (2) 중복 0건·update_pending: decideDedup 단위 테스트 + persistSubmission 로직 + pg로 (project, key, 식별값) 조회 경로·인덱스 검증.
  (3) 원본 바이너리 미저장: submissions에 바이너리 컬럼 없음(content_text=text만), 원본은 Storage에만.
  (4) typecheck·lint·build·test 통과. INV-4 클라이언트 번들 스캔(service role 키·crypto 마커 부재) 확인.
- 특이사항: 스키마는 DATA_MODEL로 정합(팩과 명칭 차이), raw 식별 컬럼·'unmatched' 상태 추가, OCR 선택기는 라우팅 편집기의 extract 부분 — 모두 DECISIONS 2026-07-08. SheetJS advisory는 세션 9 QA 재검토 항목.

### 다음 세션(6) 인계

- 세션 6 = Phase 1(b) 매칭·확인 큐·원본 삭제. 매칭 규칙 (a)~(d)는 submissions.raw_student_no(학번 일치=auto_matched)·raw_student_name(이름만=pending_confirm) 기준. LLM 후보 제안은 callLLM(purpose='매칭')→match_candidates.
- 원본 삭제(INV-5): extraction_approved_at 설정 후에만 Storage `originals` 삭제. Storage RLS는 소유자 경로만 허용하므로 삭제도 소유자 세션으로. N일 자동 삭제 보조 정책도 동일 조건.
- update_pending 항목은 세션 6 확인 큐에서 pending_content를 content_text로 반영/거부.
- Phase 2·3 진행 중에도 이 화면으로 돌아와 자료 추가 가능(매칭 규칙 동일).
- 새 마이그레이션은 `db push --db-url`. DB/RLS 검증은 스크래치 pg(미커밋).

## 세션 6 — 2026-07-08 (Phase 1(b) 매칭·확인 큐·원본 삭제) ✅ 완료

- [x] 마이그레이션 `0005_match_method.sql`: submissions.match_method(귀속 경로) 추가 — 원격 적용·pg 검증.
- [x] 매칭 엔진: 순수 함수 `lib/matching.ts`(classifyMatch) — (a)학번 일치=auto_matched(auto_number), (d)신규 학번=학생 자동 생성(auto_new_number), (b)이름만/(c)식별불가=pending_confirm(**학번 없으면 자동 없음**). `runMatching` 액션이 적용(unmatched만, 재실행 안전).
- [x] 확인 대기 큐 UI(`confirm-queue`): pending_confirm 후보(이름 일치)·선택 학생 확정·**LLM 후보 제안 지연 실행**(callLLM purpose='매칭', 근거 표시)·신규 학생 생성·보류. update_pending은 현재/새 내용 비교 후 반영/거부(수용 4).
- [x] 제출물 상세(`student-submissions`): 학생별 그룹, 내용 열람(접기/전체), 평가/생기부 반영 체크박스(자동 저장), 수정/삭제/수동 추가(source_type='manual').
- [x] 원본 삭제(INV-5): "추출 확인"(extraction_approved_at) 후에만 "원본 삭제" 활성. `deleteOriginal` 액션이 미승인 시 거부 + 공유 경로 안전 삭제 + audit. N일 자동 삭제 `/api/cron/purge-originals`(CRON_SECRET) + `isPurgeEligible`.
- [x] `/projects/[id]/submissions` 화면 + ingest↔submissions 링크. proxy.ts /api/cron 통과.
- [x] 단위 테스트 11건 추가(matching 6·retention 5) — `npm test` 30건 통과.
- [x] **수용 기준 검증**:
  (1)(2) 학번 있으면 auto_matched, 이름만은 반드시 pending_confirm·student_id NULL(정확히 1명 일치여도 자동 아님) — classifyMatch 단위 테스트 + pg로 DB 상태 확인. 학번 없는 자동 귀속 코드 경로 구조적 부재.
  (3) 미승인 원본 삭제 불가 — deleteOriginal 가드 + isPurgeEligible(미승인 always false) 단위 테스트 + pg(미승인 원본이 purge 후보 SQL에서 제외).
  (4) update_pending 반영/거부 — accept/rejectPendingContent + 확인 큐 UI.
  (5) typecheck·lint·build·test 통과. INV-4 번들 스캔(service role·CRON_SECRET 부재) 확인.
- 특이사항: 팩↔DATA_MODEL 명칭 정합(auto_matched/source_type), match_method 컬럼 신설, LLM 후보 지연 실행 — 모두 DECISIONS 2026-07-08. N일 자동 삭제의 실제 스케줄링은 운영 배선(문서화, CRON_SECRET 필요).

### 다음 세션(7) 인계

- 세션 7 = Phase 2 상대평가. `include_in_eval=true`·`student_id NOT NULL`·`match_status IN ('auto_matched','confirmed')`인 제출물만 채점 대상(스테이징·미매칭 제외 — 혼입 방지). 채점은 callLLM(purpose='평가', temperature 0).
- evaluations·student_scores 마이그레이션(0006 예정)은 세션 7. student_scores·evaluations 쓰기는 service role 전용(INV-6, DATA_MODEL 9·10절).
- (세션 4 이월) 프로젝트 설정에 evaluate/generate/verify 라우팅 편집 UI는 세션 7. extract 편집은 세션 5에서 완료.
- 새 마이그레이션은 `db push --db-url`. DB/RLS 검증은 스크래치 pg(미커밋).

## 세션 7 — 2026-07-09 (Phase 2 상대평가) ✅ 완료

- [x] 마이그레이션 `0006_evaluations_scores.sql`: evaluations(scores·total_score·content_hash·raw_llm_output·model·is_current, partial unique)·student_scores(composite·effective·rank·grade)·students.score_override/override_reason(+사유 필수 check)·projects.needs_recalc + "재계산 필요" 트리거(submissions·rubrics) + RLS(소유자 select만, 쓰기 service role 전용) — 원격 적용·pg 검증 완료.
- [x] 순수 로직 `lib/grading.ts`(GRADE_BOUNDARIES·computeStandings·deriveGrade — 배치·클라이언트 토글 공용)·`lib/scoring.ts`(submissionScore·aggregateComposite).
- [x] 평가 실행(`runEvaluation`): 반영+매칭 제출물만 `callLLM(purpose='평가', temperature 0)`, 루브릭 기준별 점수+원문 근거 인용, evaluations 저장(service role). content_hash 비교로 **증분 재평가**(내용 불변 스킵).
- [x] 합성 점수(sum/avg/weighted) → effective_score(coalesce override) 내림차순 순위 → 누적 비율 등급 파생. student_scores 재작성은 서버 배치(service role)만.
- [x] 등급제(5/9) 토글 즉시 반영(파생 재계산, 저장값 아님)·등급 분포 요약(등급별 인원·경계 점수).
- [x] 동점자 처리(best_grade=최상위 석차 / mid_rank=중간석차). 교사 보정 `setScoreOverride`(값+사유 필수, 감사 로그, 재계산)·`clearScoreOverride`. 사유 메모는 접힘/확장 UI.
- [x] "재계산 필요" 배지(projects.needs_recalc) — DB 트리거로 감지(세션 5/6 액션 미수정).
- [x] (세션 4 이월) 프로젝트 설정에 용도별 model_routing 편집 UI(`ModelRoutingForm`): 프로바이더·모델(VISION_MODELS 카탈로그 재사용+자유 입력)로 extract/evaluate/generate/verify 라우팅 변경. `updateModelRouting` 저장.
- [x] `/projects/[id]/evaluate` 화면 + 프로젝트 홈 Phase 2 링크 활성화.
- [x] 단위 테스트: `tests/grading.test.ts`(30·100명 5/9등급 누적 비율·동점·경계)·`tests/scoring.test.ts`(sum/avg/weighted·결정성)·model-routing 보강 — `npm test` 45건 통과.
- [x] **수용 기준 검증**:
  (1) 등급 경계: 100명 5등급=[10,24,32,24,10](누적 10/34/66/90/100)·9등급=[4,7,12,17,20,17,12,7,4], 30명도 각 등급 누적%가 경계 이하 — 단위 테스트.
  (2) 결정성: computeStandings·aggregate 동일 입력 동일 출력 단위 테스트 + 채점 temperature 0.
  (3) INV-6: evaluations·student_scores는 RLS select 정책만(insert 42501 거부·update 0행 — pg 실증). 등급 직접 수정 UI/코드 경로 없음(grade는 recomputeAndSave의 파생 스냅샷, service role write).
  (4) override 사유 필수: DB check(pg)·서버 액션·클라이언트 3중. 적용 시 순위·등급 재계산 + `score_override.set/clear` 감사 로그.
  (5) 증분: 현재 평가의 content_hash가 제출물 해시와 같으면 재채점 스킵(신규분만 채점) — runEvaluation 로직.
  (6) model_routing 편집 저장·재로드(updateModelRouting + 설정 재로드), purpose '평가'→evaluate 대상(변경 provider_id·model)로 라우팅 — 단위 테스트.
  (7) typecheck·lint·build·test 통과. INV-4 클라이언트 번들 스캔(service role 키·서버 전용 마커 0건) 확인.
- 특이사항: 팩 0005→**0006**(번호 충돌), evaluations/student_scores 컬럼명·override 위치를 DATA_MODEL(SSOT)로 정합, evaluations.content_hash 신설, 가중 정의·동점 처리·트리거 방식 — 모두 DECISIONS 2026-07-09. 실LLM 채점은 유효 키가 있을 때 라이브 시연(비용 발생) — 채점 호출·파싱·저장 경로는 구성·단위 테스트로 증명.

### 다음 세션(8a) 인계

- 세션 8a = Phase 3 생기부 생성·검증(최우선 핵심). INV-1/2/3을 코드 구조로 강제: 생성 함수는 단일 studentId 시그니처, 서버가 student_id 필터로 컨텍스트 조립.
- 마이그레이션 0007(records·prompt_profiles)은 세션 8a. records.sources(근거 제출물 id)·verification 저장, 쓰기(generated/verification)는 service role.
- 생성 컨텍스트의 제출물은 `include_in_record=true`·매칭 확정분만. 교사 메모는 해당 학생 레코드 귀속분만(INV-2 예외).
- 생성·검증은 callLLM(purpose='생성'/'검증') 라우팅 재사용(세션 7에서 편집 UI 완비). 새 LLM 클라이언트 금지.
- 새 마이그레이션은 `db push --db-url`. DB/RLS 검증은 스크래치 pg(미커밋).

## 세션 8a — 2026-07-09 (Phase 3 생기부 생성·검증) ✅ 완료

- [x] 마이그레이션 `0007_records_profiles.sql`: records(sources uuid[]·verification jsonb·version·origin generated/edited/manual·is_current, 학생당 현재 1행 partial unique)·prompt_profiles(owner·project_id NULL=계정 기본·guidelines/prohibitions, partial unique 2개) + RLS(소유자 select, **generated insert는 service role 전용**=INV-3, 교사 edited/manual 소유자, prompt_profiles owner-only) — 원격 적용·pg 스키마/정책 검증 완료.
- [x] 생성 컨텍스트 `lib/records/context.ts`: **`buildStudentContext(studentId, source)` 단일 studentId 시그니처(INV-1)**. `.eq('student_id')` 조회(구조적 INV-2) + 순수 `filterRecordSubmissions`(반영+매칭 확정만, 방어적 재필터). 주입형 `ContextSource`로 테스트 가능.
- [x] 생성 파이프라인 `generateRecord(projectId, studentId)`: 컨텍스트 조립 → `callLLM('생성')` 초안 → `callLLM('검증')` → `parseVerification`(문장별 근거, 환각 id 제거·강등) → records에 content·**sources(사용 제출물 id, INV-3)**·verification·version(재생성 시 +1) 저장(service role). 일괄 생성=클라이언트 학생별 순차 단일 호출(진행률 바, INV-1).
- [x] 검증 뷰(`verification-view`): unsupported 문장 하이라이트 + 문장별 [삭제/직접수정/재생성]. 직접수정·삭제는 재검증 보류(새 'edited' 버전, teacher_edited 표시), 재생성만 `regenerateSentence`가 검증 재실행(사용자 확정).
- [x] 프롬프트 프로필 화면(`/projects/[id]/profile`): 좌(참고)/우(금지) 2패널 + 분할바 드래그, 항목 추가/수정/삭제/순서변경, 계정 기본+프로젝트 오버라이드 계층(적용 순서 표기, `mergeProfileLayers`). 시드(참고 6+금지 6, `docs/SEED_PROFILE.md`) `ensureDefaultProfile`로 로드.
- [x] 예시 인제스트: `analyzeExample`(쓰기 없음, LLM purpose='생성') → diff 제안 → 항목별 승인/거부 → `applyProfileSuggestions`(승인분만) — 자동 반영 금지(수용 5).
- [x] 글자수 카운터(`char-counter`): 제한 대비 실시간 + 방식 토글(글자수 공백 포함/바이트 한글 3, 순수 `countText`). 교사 관찰 메모 박스는 세션 4 `TeacherMemoBox` 재사용(자동 저장). 버전 이력 열람.
- [x] 프롬프트 템플릿은 `lib/prompts/`(generation·verification·example-ingest·seed-profile)에 파일 분리. `callLLM(purpose='생성'/'검증')` 라우팅 재사용(새 LLM 클라이언트 없음).
- [x] 프로젝트 홈: Phase 3 링크 활성화 + 준비 섹션 "프롬프트 프로필" 카드 추가.
- [x] 단위 테스트 4종(record-context·verification·prompt-profile·text-count) — `npm test` 58건 통과.
- [x] **수용 기준 검증**:
  (1) `buildStudentContext`가 단일 studentId 시그니처(테스트 `buildStudentContext.length===2`). 가짜 2명 데이터 교차오염 테스트: A 컨텍스트에 B 제출물/내용 미포함, 버그로 소스가 전체를 반환해도 방어적 재필터로 A만 — 단위 테스트.
  (2) `records.sources`에 컨텍스트에 실제 사용된 제출물 id 배열 저장(generateRecord).
  (3) 근거 없는 문장·환각 id 모의 응답에서 grounded=false 플래그·id 제거 → records.verification 저장 — 단위 테스트.
  (4) 프로필 계층 계정→오버라이드 적용 순서·태그 — 단위 테스트.
  (5) 예시 인제스트 analyze(무쓰기)/apply(승인분만) 분리로 교사 승인 없이 프로필 불변.
  (6) typecheck·lint·build·test 통과. INV-4 클라이언트 번들 스캔(service role 키·서버 전용 마커·api-key 헤더 0건).
- 특이사항: 팩 0006→**0007**(0006 선점), edited_by_teacher→origin('edited'), guidance→guidelines, sources uuid[], verification에 grounded_by_memo/teacher_edited 확장, SEED_PROFILE 신설(원 팩 L절 미확보) — 모두 DECISIONS 2026-07-09. **records/prompt_profiles의 행위(cross-account) pg 테스트는 직접 Postgres 호스트(IPv6 전용)의 라우팅 불가(ENETUNREACH)로 보류** — 구조적 RLS(정책 qual/with_check: generated는 authenticated insert 정책에서 제외, select는 owns_project)는 pg로 확정, 정책 의미가 행위를 보장. IPv6 복구 시 재확인 권장(세션 9 RLS 전수 점검 포함). 실 LLM 생성·검증은 비용 발생 → 호출·파싱·저장 경로는 단위 테스트+구조로 증명, 유효 키 존재 시 라이브 시연.

### 세션 8a 확장 — 프롬프트 프로필 버전·이력·MD 입출력 (2026-07-10, 사용자 요청·승인) ✅ 완료(코드), ⏳ 마이그레이션 적용 대기

- [x] 사용자 요청: "권장/금지 항목이 md로 저장돼 편하게 확인·편집되고, 업데이트 시 버전·날짜시간 표시". 분석 결과 라이브 프로필을 repo MD로 두는 방식은 Vercel(읽기 전용 FS)·다중 사용자·RLS와 충돌 → **DB 단일 진실 원천 + 버전/날짜시간 + MD 내보내기/가져오기 + 이력·복원**으로 구현. SPEC 7.5 확장(승인)·DECISIONS 2026-07-10 기록. **8b 계획은 영향 없음**(결과 표와 무관).
- [x] 마이그레이션 SQL `0008_prompt_profile_versions.sql` 작성: `prompt_profiles.version int default 1` + `prompt_profile_versions`(스냅샷 이력, source seed/edit/ingest/import/restore, append-only) + RLS(owner-only).
- [x] `saveProfileLayer`(저장 시 version+1 + 이력 스냅샷), `importProfileFromMarkdown`(서버 재파싱), `listProfileVersions`·`restoreProfileVersion`(복원=새 버전). `lib/records/profile-markdown.ts`(순수 render/parse). ProfileEditor에 버전·날짜 표시·MD 내보내기·가져오기(미리보기)·버전 이력·복원 UI.
- [x] 단위 테스트 `tests/profile-markdown.test.ts`(render/parse 왕복·번호·불릿·(없음)·섹션밖 무시) — `npm test` **62건** 통과. typecheck·lint·build 통과.
- [x] **마이그레이션 0008 원격 적용 완료(2026-07-10)**: 직접 호스트(IPv6 전용) 라우팅 불가가 지속되어 **IPv4 pooler(`aws-1-ap-northeast-2.pooler.supabase.com:5432`, 세션 모드, user `postgres.<ref>`)로 `db push` 성공**. pg(pooler 경유)로 스키마 검증: version 컬럼·ppv 9컬럼·unique(profile_id,version)·정책 select+insert만(append-only) 확인.
- [x] **8a에서 보류했던 RLS 행위 테스트 완료(2026-07-10, pooler 경유)**: records — 소유자 세션 generated insert 42501 거부(INV-3)·edited insert 허용·소유자 select 가능·타 계정 select 0행·타 계정 insert 42501 거부·service role generated 허용. prompt_profiles/ppv — 소유자 insert 허용·타 계정 select 0행·ppv update 0행(append-only). 승인 사용자가 1명뿐이라 타 계정은 임의 uuid JWT 클레임으로 시뮬레이션(정책이 owner/owns_project 비교만 하므로 유효).
- [x] **예시 생기부 파일 업로드(2026-07-10, 사용자 지시)**: txt/md/docx/pdf(텍스트 레이어)/xlsx/csv 파일 → 서버 추출(`lib/records/example-file.ts`, 세션 5 파서 재사용) → 입력창 채움 → 교사 확인 후 기존 분석→diff 승인→반영 파이프라인. hwp·스캔 PDF는 명시적 안내 에러. next.config serverActions bodySizeLimit 10mb(파일 상한 8MB). 단위 테스트 5건 추가 — `npm test` **67건** 통과.

### 다음 세션(8b) 인계

- 세션 8b = Phase 3 결과 표 UI(SPEC 8절). 마이그레이션 **`0009_ui_layouts.sql`**(ui_layouts, (user_id, project_id) 유니크, layout jsonb) + RLS. (0008은 8a 확장의 prompt_profile_versions가 사용 — 세션 시작 시 최신 번호 확인.)
- 직접 DB 호스트(IPv6 전용) 라우팅이 불안정하면 **IPv4 pooler로 push/pg 가능**: `postgresql://postgres.<ref>:<pw>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres` (세션 모드 — set role·트랜잭션 동작 확인됨).
- 결과 표 4열(학생 정보|등급|교사 메모|생기부), 열 너비 드래그, 셀 3모드(접기/전체/커스텀 높이), 행·전체 토글, 레이아웃 (user_id, project_id) DB 저장(디바운스)·복원.
- 생기부 셀 직접 수정 = 새 버전 저장(origin='edited', `saveRecordEdit` 재사용 가능). 등급은 student_scores 스냅샷 + `lib/grading` 파생 표시.
- 세션 8a의 records/prompt_profiles 행위 RLS pg 검증을 IPv6 복구 후 함께 수행. 새 마이그레이션은 `db push --db-url`.

## 세션 8b — 2026-07-10 (Phase 3 결과 표 UI + 레이아웃 저장) ✅ 완료

- [x] 마이그레이션 `0009_ui_layouts.sql`: ui_layouts(user_id·project_id·layout jsonb·updated_at, **unique(user_id, project_id)**, FK cascade) + RLS(select/delete = user_id=auth.uid(), insert/update = +is_approved()) — **pooler 경유 원격 적용**·pg 스키마/제약/정책 검증 완료. (팩 0007→0009: 0007·0008 선점.)
- [x] 순수 로직 `lib/records/layout.ts`: 타입(CellMode·ColumnKey·LayoutState) + `normalizeLayout`(열 너비 클램프·stale studentId 제거·기본값·garbage 방어)·`setAllCellModes`(전체 토글)·`withMode`·`clampColumnWidth`/`clampCellHeight`. 저장·복원 양쪽에서 동일 새니타이즈, 서버 saveLayout도 재정규화(신뢰 경계).
- [x] 서버 액션 `results/actions.ts`: `saveLayout`(requireProjectOwner + ui_layouts upsert onConflict(user_id,project_id) + 서버 재정규화). 메모·생기부 편집은 세션 4 `saveTeacherMemo`·세션 8a `saveRecordEdit` 재사용(신규 액션 없음).
- [x] 결과 표(`/projects/[id]/results`): 4열(학생 정보|등급|교사 메모|생기부), `table-fixed`+colgroup, 헤더 경계 드래그 열 너비 조절, 상단 전체 접기/펼치기 토글, 디바운스(700ms) 레이아웃 저장. 등급은 student_scores 스냅샷 + `computeStandings` 파생(INV-6, 미평가는 "미평가").
- [x] 텍스트 셀(`text-cell.tsx`): 3모드(접기 1줄 말줄임 클릭 펼침 / 전체 맞춤 자동 높이 / 커스텀 핸들 드래그 높이), full·custom에서 편집(blur 저장), 행 단위 모드 토글. 생기부 셀 직접 수정 → `saveRecordEdit`로 새 'edited' 버전(내용 실변경 시 1회, 버전 남발 방지) + 로컬 버전·origin 배지 갱신. 생기부 셀에 글자수(프로젝트 카운트 방식) 표시.
- [x] 배선: records 페이지 헤더에 "결과 표" 링크, 프로젝트 홈 Phase 3에 결과 표 링크. proxy.ts는 `/projects/*` approved 게이트가 이미 커버(수정 없음).
- [x] 단위 테스트 `tests/layout.test.ts` 9건(normalizeLayout·setAllCellModes·withMode·clamp) — `npm test` **76건** 통과. typecheck·lint·build 통과.
- [x] **수용 기준 검증**:
  (1) 저장→복원: saveLayout upsert + 페이지 로드 normalizeLayout 복원. pg 행위(롤백 tx, 임시 프로젝트)로 소유자 upsert 1행·소유자 select 1행(복원)·타 계정 select 0행(격리)·타 계정 위조 insert 42501(차단) 실증. 앱-레벨 로그아웃/재로그인 e2e는 유효 세션 필요 — 저장·복원 경로·RLS는 DB로 증명.
  (2) 셀 직접 수정: `saveRecordEdit`가 origin='edited'·version+1로 새 버전 저장(세션 8a에서 RLS·동작 검증 완료, 재사용). 빈 내용·무변경은 저장 안 함.
  (3) 30명 렌더링: 일반 HTML 표 + 셀별 로컬 상태(키 입력이 30행 전체 리렌더 유발 안 함) — 구조적으로 보장.
  (4) typecheck·lint·build·test 통과. INV-4 클라이언트 번들 스캔(service role·암호화 키 0건).
- 특이사항: 팩 0007→**0009**(번호 정합), layout jsonb 형태·RLS is_approved 추가·셀 편집 재사용·pooler 적용 — 모두 DECISIONS 2026-07-10. **세션 8a에서 보류했던 records/prompt_profiles 행위 RLS는 8a 확장(2026-07-10)에서 pooler로 완료됨** — 8b 인계의 "IPv6 복구 후 함께 수행"은 이미 해소.

## (참고) 세션 8 원 골격 — 8a·8b 완료

- [x] 생기부 생성: 학생 1명 = 호출 1회(INV-1), 서버가 student_id 필터로 컨텍스트 조립(INV-2), sources 저장(INV-3), 버전 관리 — 세션 8a
- [x] 검증 패스: 문장 단위 근거 판정 → 미근거 문장 하이라이트, 삭제/수정/재생성 선택 — 세션 8a
- [x] 프롬프트 프로필: 참고/금지 2패널(분할바), 계정 기본+프로젝트 오버라이드, 시드 문체 기본값 — 세션 8a
- [x] 예시 생기부 인제스트: diff 제안 → 교사 승인 항목만 반영 — 세션 8a
- [x] 글자수 카운터 (제한 대비 실시간, 글자수/바이트 토글) — 세션 8a
- [x] 결과 표: 4열, 열 너비 드래그, 셀 3모드(접기/전체/커스텀), 행·전체 토글, 레이아웃 DB 저장·복원 — 세션 8b
- [x] **수용 기준**: 생성 호출 페이로드에 타 학생 데이터가 포함될 수 있는 코드 경로가 없음, 검증 결과가 records.verification에 저장됨 — 세션 8a

### 다음 세션(9) 인계

- 세션 9 = 통합 QA + 불변조건 감사 + Vercel 배포 준비(원 팩 I절). 스모크 시나리오 전 구간·RLS 전수 점검(전 14테이블 타 계정 차단)·INVARIANTS_AUDIT.md(INV-1~6 보장 지점 코드 특정)·환경변수 체크리스트·README·시드 스크립트.
- RLS 전수 점검 시 ui_layouts 포함. pooler 경유 pg 스크립트(스크래치, 미커밋) 재사용. `.env.local`의 SUPABASE_DB_URL은 직접 호스트(IPv6)라, pooler URL은 동일 비밀번호로 `postgres.<ref>@aws-1-ap-northeast-2.pooler.supabase.com:5432` 구성.
- Phase 3 결과 표는 student_scores 스냅샷이 있어야 등급이 표시된다(Phase 2 채점 선행). 실 LLM 생성·채점은 유효 키가 있을 때 라이브 시연(비용 발생).

## 세션 9 — 2026-07-10 (통합 QA + 불변조건 감사 + Vercel 배포 준비) ✅ 완료(자동 구간) / ⏳ 브라우저 구간 사용자 수행 대기

- [x] 자동 검증 전부 통과: `typecheck`·`lint`·`build`·`npm test`(**76/76**). 클라이언트 번들 스캔(.next/static): service role 키·`createDecipheriv`/`aes-256-gcm`·`APP_ENCRYPTION_KEY`·`encrypted_key` **0건**(공개 URL만 노출) — INV-4.
- [x] **RLS 전수 점검(16/16 PASS)**: 15개 테이블(profiles/app_settings/providers/api_keys/audit_logs/projects/students/rubrics/submissions/evaluations/student_scores/records/prompt_profiles/prompt_profile_versions/ui_layouts) + Storage `originals`(storage.objects 4정책). pooler 경유 pg, 롤백 트랜잭션에 전 체인 시드 후 `set role authenticated`+JWT 클레임으로 소유자/타 계정 대조. 타 계정 열람 0행·쓰기 차단(INSERT 42501, UPDATE/DELETE 0행), INV-3(generated service role)·INV-6(evaluations/student_scores service role) 실증. 스크립트는 스크래치·미커밋.
- [x] **docs/INVARIANTS_AUDIT.md** 작성: INV-1~6 각각의 보장 지점을 파일·함수·RLS 정책·라인 단위로 특정(INV-1/2 `buildStudentContext` 단일 studentId + `.eq(student_id)` + `filterRecordSubmissions`, INV-4 `server-only`+번들 스캔). JWT 시뮬 한계 명시.
- [x] **실 LLM 라이브 1회(PASS)**: 사용자 승인·키 제공(OpenAI). service role 하니스로 임시 프로젝트+학생 2명 시드 → 실 lib 파이프라인(평가→생성→검증, gpt-4o-mini 6호출) → 저장 재조회 검증 → 임시 데이터·등록 키 삭제(미영속). 키 경로(encrypt→resolveApiKey→decrypt), 컨텍스트 본인 제출물만(INV-1/2), sources 저장(INV-3), 검증 미근거 문장 플래그 모두 정상. 결과 `docs/SMOKE_TEST.md`.
- [x] **SheetJS advisory 재검토(세션 5 이월)** → CDN 0.20.3 업그레이드로 high 2건 해소. `docs/DECISIONS.md` 기록.
- [x] **docs/SMOKE_TEST.md**: 자동 구간 결과 + 브라우저 구간 사용자 체크리스트(가입→대기→승인→…→재로그인 복원 15단계) + 실 LLM 라이브 결과.
- [x] **README.md**: 개요·스택·환경변수 체크리스트(7종)·로컬 개발·Supabase 설정(OAuth·마이그레이션·시드 3경로)·Vercel 배포(빌드·환경변수·Cron)·운영 가이드·보안·문서 맵.
- [x] **vercel.json**(purge-originals Cron 매일 03:00 UTC, CRON_SECRET Bearer) + **.env.example** 보완(SUPABASE_DB_URL, Google OAuth 위치 안내).
- [x] 시드 3경로(ADMIN_EMAIL 콜백 승격/0002 프로바이더/ensureDefaultProfile) 확인 — 부족분 없음, README 문서화(새 시드 스크립트 미생성).
- [x] **수용 기준 자체 점검**:
  (1) 스모크 시나리오: 자동 구간 + 실 LLM 라이브 1회 통과, 브라우저 구간은 사용자 수행 체크리스트 제공(SMOKE_TEST.md).
  (2) INVARIANTS_AUDIT.md 완성 — INV-1/2/4 보장 지점이 코드 위치(파일·라인)로 특정됨.
  (3) RLS 전수 15테이블 + storage 정책 통과(16/16).
  (4) README만으로 배포 가능한 수준(환경변수·마이그레이션·Vercel·Cron·시드·운영).
  (5) typecheck·lint·build·test 통과.
  (6) SheetJS advisory 재검토 결론(업그레이드 완화) DECISIONS.md 기록.
- 특이사항: xlsx 의존성 소스가 npm→SheetJS CDN tgz로 변경(0.20.3). 라이브 검증 OpenAI 키는 대화 노출로 **회전 권고**(라이브 후 등록 키 삭제·미영속). 브라우저 OAuth 구간은 에이전트 수행 불가 → 사용자 체크리스트 위임(수행하지 않은 구간을 통과처럼 표기하지 않음).

## 핫픽스 — 2026-07-10 (프로젝트 생성 중복 제출 버그) ✅ 완료

- [x] 증상: 생성 폼 '만들기' 클릭 후 서버 액션 응답 지연 동안 UI 피드백이 없어 연타 → 동일 프로젝트가 클릭 수만큼 중복 생성.
- [x] 수정(`components/projects/project-list.tsx`): ① `CreateFormFooter`(useFormStatus — settings-form의 SubmitButton과 동일 관용구)로 제출 중 만들기·취소 비활성 + "만드는 중…" 표시, ② `handleCreate` 래퍼의 `useRef` 동기 가드로 pending 재렌더 이전의 연타도 액션 레벨에서 차단(중복 POST 미전송).
- [x] typecheck·lint·build·`npm test`(76/76) 통과. DECISIONS 2026-07-10 기록.
- 특이사항: 같은 파일의 수정/삭제 폼도 pending 미표시는 동일하나 중복 실행이 데이터 중복을 만들지 않아 범위 제외(공용 SubmitButton 추출은 후속 제안).

## 모델 목록 동적 조회 — 2026-07-10 (사용자 요청, SPEC 3절 확장 승인) ✅ 완료

- [x] **원인 규명**: "OpenAI 모델이 안 보인다"는 유실이 아니라 미구현. openai는 프로바이더 드롭다운에 정상 노출됐고(DB의 `model_routing.provider_id`가 openai UUID로 저장돼 있어 확인), 안 보인 것은 모델 후보였다 — 모델 칸이 `<select>`가 아니라 `<datalist>` 자유 입력이라 브라우저가 입력값(`claude-sonnet-4-6`)으로 후보를 필터링해 `gpt-*`가 하나도 매칭되지 않았다. DECISIONS 2026-07-09에 정적 카탈로그 재사용이 의도적 결정으로 기록돼 있었음.
- [x] **SPEC 3절 확장**(사용자 승인): 키 검증 → 모델 목록 저장 → [모델 갱신] → 키 있는 프로바이더만 라우팅 선택. DATA_MODEL 4절 갱신.
- [x] **마이그레이션 0010** `api_keys.models jsonb not null default '[]'` + `models_synced_at` — pooler 경유 **적용·검증 완료**(기존 openai 키 1행은 `models: []` → 화면이 정적 카탈로그로 폴백하고 [모델 갱신] 유도).
- [x] `lib/llm/models.ts`(서버 전용): 프로바이더별 모델 목록 조회 + 순수 파서(anthropic/openai/google) + OpenAI 채팅 모델 필터. `lib/llm/key-sync.ts`: `validateKeyAndListModels`(등록 시 검증), `refreshKeyModels`(재조회). `lib/llm/available.ts`: `listRoutableProviders`(개인>기본 키 우선, service role, encrypted_key 미select).
- [x] `setPersonalKey`/`setDefaultKey`를 useActionState로 전환 — 검증 실패를 인라인 표시(오타 하나에 전체 페이지가 죽던 문제 해소). `refreshPersonalKeyModels`/`refreshDefaultKeyModels` 추가, audit `api_key.models_refresh`(평문·목록 미기록, 개수만).
- [x] 계정 옵션·관리자 패널: 모델 개수·마지막 조회 시각 표시, [모델 갱신] 버튼, 제출 중 비활성.
- [x] `ModelRoutingForm`: 모델 `<select>` + [직접 입력…], 프로바이더 변경 시 모델 리셋, 키 없는 프로바이더 숨김, 키 전무 시 전체 비활성 + `/account` 안내, 저장된 프로바이더 키가 사라지면 경고.
- [x] **실 API 라이브 검증**(읽기 전용·무과금): 등록된 openai 키로 `/v1/models` 호출 → 원본 120개 중 56개 제외(임베딩·TTS·whisper·realtime·image·sora·moderation·instruct·codex·search-api) → 64개 통과. `-codex`·`-search-api`는 responses API 전용이라 제외 규칙 추가.
- [x] `tests/provider-models.test.ts` 8건 추가 — `npm test` **84/84** 통과. typecheck·lint·build 통과. 클라이언트 번들 스캔(.next/static): `x-api-key`·`api.anthropic.com`·`generativelanguage`·`listProviderModels`·`encrypted_key`·`APP_ENCRYPTION_KEY` **0건**(INV-4).
- ⚠️ **인계**: Tongsa 프로젝트의 `model_routing`은 provider=openai + model=`claude-*`로 저장돼 있다(구 자유 입력 UI의 산물). 새 UI에서 4개 용도의 모델을 다시 고르고 저장해야 Phase 2/3가 동작한다.
- ⚠️ **인계**: OCR 모델 선택기(`OcrModelSelect`)는 정적 `VISION_MODELS` 유지(비전 가능 판별 불가). 라우팅 화면과 달리 키 없는 프로바이더도 노출된다 — 동일 처리를 원하면 후속 세션에서.

## 매칭 자동화 + 재귀속 — 2026-07-11 (사용자 요청, SPEC 5.2 개정 승인) ✅ 완료(자동 구간) / ⏳ 브라우저 매칭 실행 사용자 확인 대기

- [x] **원인 규명**: "일일이 승인이 힘들다"의 근본 원인은 승인 UI가 아니라 식별값 부재였다. `auto_matched`는 이미 큐를 건너뛰지만, 개별 파일(docx·pdf·이미지) 업로드가 `raw_student_no/name`을 하드코딩 `null`로 넣어(ingest/actions.ts) 전부 "식별 불가"로 분류 → 파일 수만큼 LLM 후보 조회 + 교사 수동 선택. 대조할 식별값이 없어 자동화 대상 자체가 없었음.
- [x] **SPEC 5.2 개정**(사용자 승인): 자동 귀속을 "학번 일치"에서 "명단과 모호하지 않게 일치"로 확대(학번 완전 일치 + 이름 유일 일치). 식별값 3경로(column/filename/llm)와 출처 기록, 재귀속 추가. SPEC 5.4에 재귀속 항목. DATA_MODEL 8절 갱신.
- [x] **마이그레이션 0011** `submissions.identity_source text check(column/filename/llm)` — pooler 경유 **적용·검증 완료**. 백필: 기존 158행(raw_student_no/name 보유)을 `column`으로. match_method 값 확장(auto_name·reassigned)은 0005가 check 제약 없이 도입해 DDL 불필요.
- [x] `lib/matching.ts` 재작성: `classifyMatch`(auto_name·number_conflict·number_unknown 추가, identitySource 인자) + `deriveIdentityFromFilename`(파일명×명단 교차 대조, 숫자/한글 토큰 경계, 2명 이상 걸리면 포기) + `containsToken`·`fileBasename` 순수 함수.
- [x] `runMatching` 재작성: 열 → 파일명 → LLM(문서 앞부분 1500자, 명단 학생 1명 지목, 환각 응답 폐기) 순으로 식별값 확보 후 분류. LLM 실행당 20건 상한·동시 4·건별 실패 격리. 신규 학생 자동 생성은 column 출처에 한정(유령 학생 방지).
- [x] `reassignSubmission` 액션 — [다른 학생으로 이동] select, audit `submission.reassign`(이전/이후 student_id), needs_recalc는 기존 트리거가 자동 세움.
- [x] UI: 매칭 요약(학번/이름/신규/대기 + 파일명·LLM 출처 + 상한 초과 재실행 안내), 학생별 제출물에 귀속 경로·출처 배지(LLM 자동 귀속은 앰버 강조)·[다른 학생으로 이동], 확인 큐에 대기 사유 표시(동명이인 N명/학번 오타 의심/명단 미일치/식별 불가). `/submissions` maxDuration=60.
- [x] `tests/matching.test.ts` 19건(구 "이름 1명이여도 자동 금지" 수용 2 반전, 파일명 교차 대조 신규 다수) — `npm test` **97/97**. typecheck·lint·build 통과.
- ⚠️ **브라우저 매칭 실행 미검증(인계)**: 순수 함수(파일명 대조·분류)는 97건으로 검증했으나, 실제 파일 업로드 → 매칭 실행(LLM 호출 포함) → 배지·큐 표시 → 재귀속의 전 구간은 Google 로그인·LLM 비용이 필요해 에이전트가 라이브 구동하지 못함. 배포 후 사용자 확인 필요. LLM 매칭은 유효 키·모델 라우팅이 선행돼야 동작(위 모델 목록 인계 참조).

### 배포 전 사용자 수행 필요(인계)

- `docs/SMOKE_TEST.md` [B] 브라우저 15단계(2번째 Google 계정으로 가입→대기→승인→업로드→매칭→평가→생성→표 편집→재로그인 복원) 수행·결과 기록.
- ~~Supabase Google 프로바이더 활성화 + Redirect URLs 등록~~ ✅ 배포 도메인에서 로그인 성공으로 확인. ~~마이그레이션 `db push` 적용~~ ✅ 0001~0010 전부 적용 확인.
- Vercel 환경변수: `APP_ENCRYPTION_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 미등록 탓에 `/account` 키 저장이 500(digest 685131230)이었음 → 사용자가 등록·재배포 후 정상. `CRON_SECRET`은 자동 삭제 Cron을 켤 때 추가(미등록 시 라우트가 503만 반환하고 나머지 기능은 무관).
- 노출된 OpenAI 키 폐기·재발급 후 `/admin`(기본 키) 또는 `/account`(개인 키)에 재등록.
- **0010 배포 순서**: 마이그레이션을 먼저 적용해야 `/account`·`/admin`·프로젝트 설정이 뜬다(`models` 컬럼을 select 함). 이미 적용 완료.

## 리팩토링 — 채점 전멸 수정 + 실행 관찰가능성 (2026-07-11, 배치 1~4) ✅ 완료(자동 구간) / ⏳ 브라우저 실검증 사용자 대기

> 상세 진행·인계는 `docs/리팩토링_프로그레스.md`, 설계 판단은 `docs/DECISIONS.md`(2026-07-11 리팩토링 배치 1~4). 실행 지시서는 `docs/리팩토링.md`(v2, 배치 4개).

- **원인**: 채점 158건이 두 차례 전멸했으나 화면에 사유가 없었다. ① OpenAI 어댑터가 gpt-5·o 계열이 거부하는 legacy 파라미터(`max_tokens`·`temperature`)를 전송(탐침 A/D 400) ② generate/verify의 `gpt-5.5-pro`는 chat 모델 아님(탐침 C 404) ③ 에러가 `catch {}`에서 버려짐 ④ 전건을 한 서버 액션에서 돌려 진행 표시·중단 불가 + 성공 시 타임아웃 확정.
- **배치 1**(어댑터·모델 선별·라우팅): OpenAI 어댑터를 계열 분기(`isOpenAIReasoningFamily`→`max_completion_tokens`, temperature 생략)로 현대화 + 빈 응답 throw(무음 0점 저장 방어), 모델 카탈로그 `-pro` 제외 + 소비 시점 재필터, Tongsa generate·verify를 `gpt-4o-mini`로(DB). 신규 테스트 `tests/openai-params.test.ts`.
- **배치 2**(실행 터미널·채점 전환): 공용 `useSequentialRun` 훅 + 표시 전용 `RunTerminal`(로그·크기조절·일시정지/재개/긴급중단·서킷 브레이커 연속 3실패). `runEvaluation`→`prepareEvaluation`·`evaluateOne`·`finalizeEvaluation` 3분할(클라이언트 구동 1건 실행, 에러 원문 300자 노출, INV-2로 id만 받고 서버가 루브릭 재조립). 평가 화면 모델 배지 + `maxDuration=120`.
- **배치 3**(매칭 전환·records 배지): `runMatching`(20건 상한)→`prepareMatching`·`matchOneByLlm`·`finalizeMatching` 3분할(상한 소멸, 결정적 규칙은 prepare 일괄·LLM 건만 1건 실행), `matching-panel` 개편 + extract 모델 배지. records 화면에 생성·검증 모델 배지.
- **배치 4**(SPEC·최종 검증): SPEC 6절 temperature 문구 완화 + 채점 실행 터미널·중단·증분 명문화, SPEC 5.2 매칭 1건 단위 실행 명문화. 최종 검증 전부 통과(`npm test` 102/102·tsc·eslint·next build 19라우트) + **INV-4 번들 스캔 7종 전부 0건**. DATA_MODEL·DB 스키마 변경 없음.

### 배포 후 사용자 체크리스트 (에이전트 미수행 — OAuth·LLM 과금 필요)

1. **[모델 갱신]**: `/account`(또는 `/admin` 기본 키) → openai 키의 [모델 갱신] 1회 → 저장 모델 목록에서 `-pro`가 사라지고, 프로젝트 설정 라우팅 목록에도 `-pro`·이미지·음성 계열이 나타나지 않음 확인(수용 4).
2. **모델 배지**: 평가 화면 "평가 모델: {provider}/{model}", 매칭 화면 "추출·매칭 모델: …", records 화면 "생성/검증 모델: …" 표시 확인(요구 ②).
3. **(선택) 비용 절감**: 프로젝트 설정에서 evaluate를 `gpt-4o-mini` 등 저비용 chat 모델로 변경(현재 Tongsa evaluate는 gpt-5 계열 — 배치 1 어댑터로 정상 호출되나 지연·비용 큼).
4. **채점 실행**: [채점 실행] → 실행 터미널 로그 흐름(prelude→건별→finalize) 실시간 확인, **일시정지→재개→긴급 중단** 동작, 중단 후 재실행 시 이미 채점된 건 제외하고 증분 이어감(수용 2·3). 오늘 같은 실패라면 터미널에 `'max_tokens' is not supported…` 원문이 보이고 연속 3건에서 자동 중단(수용 1). 로그 창 우하단 핸들로 크기 조절.
5. **매칭 실행**: [매칭 실행] → 결정적 처리(prelude) + LLM 대상 건별 실행, 중단·재개·재실행(미매칭만 이어감). 자동 귀속·큐 결과는 학생별 제출물 배지·확인 큐에서 확인, 틀렸으면 [다른 학생으로 이동].

## 리팩토링 2 — 대시보드 수직 통합 + 작업결과표 + 999점 표시 점수 + PDF 버그 + 진실성 검증·도서팩트시트 (2026-07-13, 배치 1~12) ✅ 완료(자동 구간) / ⏳ 브라우저·외부 API 실검증 사용자 대기

> 상세 진행·인계는 `docs/리팩토링_2_프로그레스.md`, 설계 판단은 `docs/DECISIONS.md`(2026-07-12·13 리팩토링 2 준비·배치 1~12). 실행 지시서는 `docs/리팩토링_2.md`(v2, 배치 12개). 마이그레이션은 0012(display_score)·0013(factsheets·factsheet_entries·submissions 진실성 3컬럼) 두 개.

- **배치 1**(PDF 버그·기반 타입): `parsePdfText(bytes.slice())` 방어 사본으로 detach 제거("The document has no pages" 원인) + OCR 빈 데이터 가드, OpenAI PDF file 파트 지원(전 프로바이더 스캔 OCR), `isVisionCapableModel` 순수 함수, ModelRouting `default`·`rubric` 키 + `updateModelRouting` 키 보존.
- **배치 2**(999점 표시 점수): 마이그레이션 0012, `lib/scores/display.ts`(초기 확정 인원·800~200 스프레드·중간 삽입·소진 시 재배치·sticky), `recomputeAndSave` 개편(확정 대기 국면=행 미생성), override 0~999.
- **배치 3~4**(작업결과표): `lib/worksheet/*`(8열 계약·정렬/필터/감춤/너비/행높이/다운로드·refresh 이벤트) + `WorksheetTable` + 상호작용(제출물 펼침·빈 칸 앵커·오버라이드·학생 편집·생기부/메모 인라인), 구 /results·/students 제거(redirect).
- **배치 5**(대시보드 수직 개편): phase-0~3 + worksheet 앵커, 페이즈 0(API 키 상태·인라인 등록·기본 AI 모델·전 페이즈 교체 질문).
- **배치 6~7**(페이즈 1·2·3 이식): 업로드-추출 분리 + [수합 & 매칭] 자동 연쇄(`useSequentialRun` nextStage)·OCR 동적 드롭다운, 루브릭 확장(평가계획서 AI 분석·전담 모델·xlsx), 생기부 일괄 생성 터미널·가성비 추천. 구 /ingest·/evaluate 제거.
- **배치 8~11**(진실성 검증·도서팩트시트): 마이그레이션 0013·검색 클라이언트(알라딘·네이버)·/factsheets 페이지, 자동 생성·보강 파이프라인(`filterBySnippetMatch` 할루시네이션 구조 차단), 평가 실행에 진실성 검증 스테이지 연쇄(식별→팩트시트 대조·자동 생성→플래그, 자동 감점 없음), 공유·관리자 승인 + AI 엄격 자동 검증.
- **배치 12**(SPEC·최종 검증): SPEC 4·5.1·5.2·6(표시 점수·6.1 진실성·6.2 도서팩트시트)·7.5·8(작업결과표)·9·12절 개정, DATA_MODEL·DECISIONS·README 점검. 최종 검증 전부 통과: `npm test` **195/195**·`tsc --noEmit`·`eslint`·`next build`(21라우트), **INV-4 번들 스캔 9패턴 전부 0건**(x-api-key·api.anthropic.com·generativelanguage·encrypted_key·APP_ENCRYPTION_KEY·createDecipheriv·SUPABASE_SERVICE_ROLE_KEY·ALADIN_TTB_KEY·NAVER_CLIENT_SECRET), 제거 심볼 9종 0건.

### 배포 후 사용자 체크리스트 (에이전트 미수행 — OAuth·LLM·외부 API 키·과금 필요)

1. **통사 9반 PDF**: 재업로드 → [수합 & 매칭] → OCR 성공(Google·OpenAI 모델 각각), "The document has no pages" 재발 없음(배치 1 detach 수정 실증).
2. **업로드 토큰 미소모**: 업로드 시 네트워크에 LLM 호출 없음, 파일 목록 체크/해제·미수합 파일 삭제.
3. **수합→매칭 연쇄**: [수합 & 매칭] 한 번으로 수합→"── 다음 단계 ──"→매칭, 1건마다 작업결과표 행 갱신, 애매 건만 확인 대기 큐.
4. **표시 점수**: 채점 → 초기 확정 인원(15~25명) 전 "확정 대기" → 충족 후 800~200 배정(간격 ≥15) → 추가 채점 사이 삽입, 재계산에도 유지.
5. **작업결과표**: 정렬/값 필터/열 감춤/행 높이/전체 접기·펼치기, 다운로드(전체·선택 — `프로젝트명-yymmddHHmm.xlsx|csv|md`).
6. **셀 편집**: 반영 점수 오버라이드(저장/취소·사유 필수), 학번·이름 [학생별 데이터 편집](추가/삭제 포함), 생기부·메모 인라인.
7. **페이즈 0 기본 모델**: 저장 → 개별 설정과 다르면 교체 질문 → [전부 교체] 후 설정 4용도 일치.
8. **루브릭**: 평가계획서 업로드 → AI 제안 diff → 교사 승인 항목만 반영(자동 저장 없음), xlsx 다운로드.
9. **생기부 일괄 생성**: [생기부 일괄 생성] 터미널(1건마다 생기부 열 갱신·INV-1 학생별 순차).
10. **빈 칸 앵커**: 작업결과표 빈 갯수/점수/등급/생기부 칸 클릭 → 해당 페이즈(#phase-1~3)로 스크롤.
11. **검색 키 등록**: 알라딘 ttbkey·네이버 client id/secret 발급 → Vercel·로컬 환경변수 등록(선택 — 미설정 시 팩트시트 자동 수집만 비활성).
12. **/factsheets**: 도서 검색 → 생성 → [자동 보강] 터미널 → entry 출처 URL·발췌 확인.
13. **촬영본 보강**: 책 페이지 사진·캡처 PDF 업로드 → OCR → 라벨 → entry 추가.
14. **진실성 검증**: 독서 제출물 채점 실행 → 진실성 스테이지 로그(팩트시트 자동 생성 → 같은 책 2번째 학생부터 재사용) → 의심 배지·근거 펼침, 의심이어도 채점 진행(자동 감점 없음).
15. **공유 승인**: 교사 [전체 공유 신청] → /admin 승인 대기 큐 → [AI 엄격 검증 실행] 리포트 → [승인] → 타 계정 /factsheets·평가 재사용 확인.
