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

## 세션 8 — (예정) Phase 3 생기부 + 결과 화면

> 분량이 크므로 필요 시 8a(생성·검증)/8b(프로필·결과 표)로 분할 가능.

- [ ] 생기부 생성: 학생 1명 = 호출 1회(INV-1), 서버가 student_id 필터로 컨텍스트 조립(INV-2), sources 저장(INV-3), 버전 관리
- [ ] 검증 패스: 문장 단위 근거 판정 → 미근거 문장 하이라이트, 삭제/수정/재생성 선택
- [ ] 프롬프트 프로필: 참고/금지 2패널(분할바), 계정 기본+프로젝트 오버라이드, 시드 문체 기본값
- [ ] 예시 생기부 인제스트: diff 제안 → 교사 승인 항목만 반영
- [ ] 글자수 카운터 (제한 대비 실시간, 글자수/바이트 토글)
- [ ] 결과 표: 4열, 열 너비 드래그, 셀 3모드(접기/전체/커스텀), 행·전체 토글, 레이아웃 DB 저장·복원
- [ ] **수용 기준**: 생성 호출 페이로드에 타 학생 데이터가 포함될 수 있는 코드 경로가 없음, 검증 결과가 records.verification에 저장됨
