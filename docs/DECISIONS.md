# DECISIONS — 설계 판단 기록 (약식 ADR)

> 형식: `날짜 / 판단 / 이유` 한 줄씩. 스펙에 없던 판단, 스펙 개정, 스택 선택 등을 기록한다.
> 최신 항목을 아래에 추가한다.

- 2026-07-07 / 4문서 체계(SPEC·CLAUDE·PROGRESS·DECISIONS)로 세션 간 일관성 유지 / 분리된 세션에서도 단일 진실 원천과 인계 절차가 있어야 제품이 일관되므로.
- 2026-07-07 / SPEC.md를 내용 없이 구조(템플릿)만으로 먼저 생성 / 세션 0 시점에 제품 정의가 아직 입력되지 않았고, 임의로 기능을 창작하면 SSOT의 신뢰가 깨지므로. 내용 확정 전까지 상태를 `초안 대기`로 표시.
- 2026-07-07 / SPEC.md를 사용자 제공 명세(0~11절)로 확정, DATA_MODEL.md를 5번째 필독 문서로 추가 / 제품 정의가 입력되었고, 스키마는 SSOT와 분리해 상세 관리하는 편이 세션 간 인계에 안전하므로.
- 2026-07-07 / 구현을 세션 1~8로 분할(1 스캐폴딩·DB → 2 인증 → 3 API 키 → 4 프로젝트 기초 → 5·6 Phase 1 → 7 Phase 2 → 8 Phase 3) / 의존성 순서(인프라→인증→키→도메인→파이프라인)를 따르고, 각 세션이 독립 검증 가능한 수용 기준을 갖도록. Phase 3은 분량상 8a/8b 분할 여지를 명시.
- 2026-07-07 / 합성 점수 기본값 = 평균(avg) / 스펙에 기본값 미명시. 제출물 수가 학생마다 다를 수 있어 합(sum)보다 공정하므로. `[확인 필요]` — 사용자 확인 대기.
- 2026-07-07 / 동점자 처리 기본값 = 상위 등급 부여 / 스펙에 기본값 미명시. 학생에게 유리한 방향이 교육 현장 관행에 가까우므로. `[확인 필요]` — 사용자 확인 대기.
- 2026-07-07 / 생기부 글자수 제한 기본값 = 500자(공백 포함) / 스펙에 기본값 미명시. 과목별 세부능력특기사항 관행(500자)을 따름. `[확인 필요]` — 사용자 확인 대기.
- 2026-07-07 / 원본 자동 삭제 기본값 = 끄기, 선택지 7일/30일 / 스펙에 값 미명시. 삭제는 비가역이므로 기본은 보수적으로 끔. INV-5(추출 승인 전 삭제 금지)가 자동 삭제보다 항상 우선. `[확인 필요]` — 사용자 확인 대기.
- 2026-07-07 / student_scores에 grade 컬럼을 저장하되 서버 재계산 배치 전용(RLS로 클라이언트 쓰기 차단), 등급제 토글의 즉시 반영은 rank+매핑표로 화면 파생 / INV-6("직접 저장·수정 금지")을 "시스템 파생 계산 결과의 스냅샷 저장은 허용, 사용자 수정 경로는 금지"로 해석. 토글 즉시 반영 요구(SPEC 6절)를 재계산 없이 충족하기 위해.
- 2026-07-07 / submissions.student_id를 NULL 허용으로 설계, NULL이면 평가·생성 컨텍스트에서 무조건 제외 / 매칭 확정 전 제출물을 잘못된 학생에 귀속시키지 않기 위한 보수적 설계(혼입 방지). match_status enum(auto_matched/pending_confirm/confirmed/update_pending)과 pending_content로 자동 덮어쓰기 금지를 구조화.
- 2026-07-07 / evaluations·student_scores·records(generated)·audit_logs의 쓰기는 service role 전용, 클라이언트 RLS로는 select만 허용 / 채점·등급·생성 결과를 클라이언트가 위조할 수 없어야 INV-3·INV-6과 감사 무결성이 성립하므로.
- 2026-07-07 / enum은 Postgres enum 타입 대신 text+check 제약 사용 / enum 타입은 값 추가·삭제 마이그레이션이 번거로워 초기 개발 단계에 부적합.
- 2026-07-07 / `[확인 필요]` 4건 확정: 합성 점수 기본값 평균, 동점자 상위 등급 부여, 글자수 제한 500자, 원본 자동 삭제 끄기 / 사용자가 제안값 그대로 승인. SPEC·DATA_MODEL에서 `[확인 필요]` 표시 제거.
- 2026-07-07 / 세션 구획 재편: 세션 1 = 스캐폴드+인증+가입 승인(마이그레이션은 profiles·app_settings만), 세션 2 = 관리자 패널 UI, 잔여 테이블은 해당 도메인 세션에서 마이그레이션 / 사용자 세션 지시에 따름. SPEC과 충돌 없음.
- 2026-07-07 / is_admin()·is_approved() 헬퍼를 세션 1에서 작성 (DATA_MODEL 원계획은 세션 2) / 세션 1의 RLS 정책(admin 전용 쓰기)에 즉시 필요하고, SECURITY DEFINER로 profiles 정책 재귀를 피해야 하므로.
- 2026-07-07 / 최초 관리자 지정 = 환경변수 ADMIN_EMAIL + OAuth 콜백에서 service role로 멱등 승격(role='admin', status='approved') / DB 트리거는 환경변수를 읽을 수 없고, 시드 SQL은 auth.users 생성 전에 실행 불가. 콜백 방식이 멱등·자동이므로.
- 2026-07-07 / 미들웨어 파일명을 proxy.ts로 채택 / Next.js 16이 middleware.ts를 proxy.ts로 개명(둘 다 동작). 신규 프로젝트이므로 현행 규약을 따름. 동작은 SPEC 2절 "미들웨어에서 강제" 그대로.
- 2026-07-07 / profiles에 클라이언트 insert 정책을 두지 않고 타입에서도 Insert: never / 프로필 생성 경로를 auth 트리거(handle_new_user) 하나로 한정해 위조 가입을 구조적으로 차단.
- 2026-07-07 / DB 행 타입은 interface가 아닌 type 별칭으로 선언 / postgrest-js의 Record<string, unknown> 제약은 암시적 인덱스 시그니처가 필요한데 interface는 이를 만족하지 못해 전 결과가 never로 추론되는 문제 확인.
- 2026-07-07 / 마이그레이션 적용은 supabase CLI `db push --db-url` 방식(연결 문자열은 .env.local의 SUPABASE_DB_URL, 커밋 금지) / psql 미설치 환경이고, CLI가 supabase_migrations 이력 테이블로 세션 간 증분 적용을 관리해 주므로. DB 검증용으로 pg를 devDependency에 추가.
- 2026-07-07 / 제공된 Supabase 프로젝트에 있던 이전 앱 테이블 4종(checkpoints, factsheets, projects, users) drop / 세션 4의 projects 테이블과 이름 충돌. 사용자가 "기존 테이블 삭제"를 명시 선택함.
- 2026-07-08 / 세션 2 범위 = 관리자 패널 + API 키 체계·crypto·LLM 통합 클라이언트(원 PROGRESS의 세션 2 + 세션 3 병합) / 사용자 세션 2 지시에 따름. SPEC과 충돌 없음. 잔여 세션 번호는 한 칸씩 당겨지지 않고 PROGRESS에 병합 표기.
- 2026-07-08 / audit_logs 테이블을 세션 2에서 도입(DATA_MODEL 원계획상 후속 세션 예정이었음) / 수용 기준 4(승인/거부/삭제가 audit_logs에 기록)를 충족하려면 이 세션에 필요. RLS: insert 정책 없음(=service role 전용), select는 admin, update/delete 없음(append-only).
- 2026-07-08 / callLLM 시그니처는 modelRouting({provider_id, model} per RoutingKey)를 인자로 받고, purpose 추출·매칭은 모두 extract 키를 공유 / 프로젝트 model_routing 테이블은 세션 4에서 도입되므로, 세션 2 시점엔 라우팅을 호출부가 주입하도록 설계. DEFAULT_MODELS(추출/매칭 haiku, 평가/생성/검증 sonnet-4-6)는 lib/llm/routing.ts 상수로 두어 세션 4 기본값 조립에 재사용.
- 2026-07-08 / resolveApiKey는 서비스 롤(admin 클라이언트)로 키를 조회하고 서버에서 복호화 / 기본 키(owner_id NULL)는 api_keys RLS상 admin만 select 가능하므로, 일반 교사가 기본 키를 사용하려면 서버 서비스롤 조회가 필수(INV-4: 복호화·평문은 서버 전용). 단위 테스트 가능성을 위해 fetchRows·decryptFn을 주입 가능하게 설계(기본값은 실제 구현).
- 2026-07-08 / api_keys 쓰기(개인·기본)는 사용자 세션 클라이언트(RLS 경로)로, 프로필 삭제와 audit_logs 기록은 service role로 수행 / 개인 키=본인·기본 키=admin RLS를 실제로 통과시켜 권한을 이중 검증. 계정 삭제는 auth.users 삭제가 필요해 service role 불가피, 감사 로그 insert도 service role 전용.
- 2026-07-08 / 서버 액션은 진입 시 requireAdmin()/requireApproved()로 권한을 한 번 더 강제(proxy.ts 경로 가드 + RLS와 함께 심층 방어) / 서버 액션은 경로와 무관하게 호출될 수 있으므로 미들웨어만으로는 부족.
- 2026-07-08 / 단위 테스트 러너 = node:test + tsx, `--conditions=react-server`로 실행 / 최소 의존성. server-only 패키지는 기본 export 조건에서 throw하므로 react-server 조건을 줘 empty 모듈로 해석시켜야 서버 전용 모듈을 테스트에서 로드 가능.
- 2026-07-08 / lib 구조는 crypto/·llm/ 디렉토리 채택(CLAUDE.md 디렉토리 계획), 세션 지시의 단일 파일(lib/crypto.ts·lib/llm.ts) 대신 / llm은 프로바이더 어댑터가 여러 개라 디렉토리가 자연스럽고 CLAUDE.md 구조와 일치. import 경로는 @/lib/crypto·@/lib/llm(index)로 동일하게 노출.
- 2026-07-08 / rejected 사용자 안내 문구는 이번 세션에서 별도 분리하지 않고 /waiting 공통 화면 유지 / 별도 문구 정책은 사용자 요청이 없어 보류. 필요 시 후속 세션에서 app_settings에 rejected_message 키 추가로 확장 가능.
- 2026-07-08 / (세션 4) projects에 description(text, nullable) 컬럼 추가, DATA_MODEL 5절 갱신 / 세션 4 지시가 "이름, 설명"을 명시. SPEC 4절은 컬럼을 열거하지 않아 충돌 없음. 스키마 SSOT(DATA_MODEL) 갱신 후 마이그레이션.
- 2026-07-08 / (세션 4) 세션 지시의 `student_no`는 DATA_MODEL 7절 `student_number`의 약칭으로 간주해 `student_number` 채택 / 컬럼명은 스키마 SSOT(DATA_MODEL)를 따른다.
- 2026-07-08 / (세션 4) Phase 2 전용 컬럼(students.score_override·override_reason, projects.needs_recalc)은 0003에서 제외하고 세션 7 마이그레이션으로 연기 / "각 세션에 필요한 테이블/컬럼만 추가"라는 세션 지시 준수. 세션 4엔 소비처(채점·재계산)가 없어 추가하면 강제되지 않는 dead schema가 됨. DATA_MODEL에 "세션 7 추가" 주석으로 시점만 명시(최종 스키마는 불변).
- 2026-07-08 / (세션 4) projects.model_routing은 SQL 컬럼 default 없이 not null만 두고, createProject 서버 액션이 buildDefaultModelRouting()으로 조립해 삽입 / Postgres 컬럼 default는 다른 테이블(providers)의 시드 provider_id를 서브쿼리로 참조할 수 없음. lib/llm/routing.ts의 DEFAULT_MODELS + 이름으로 조회한 anthropic provider_id로 앱에서 조립(세션 지시: 새 상수 만들지 말 것). DATA_MODEL 5절의 "default 시드값" 문구를 이에 맞게 수정.
- 2026-07-08 / (세션 4, 수용 기준 3) 프로젝트 삭제 시 하위 students·rubrics는 FK on delete cascade로 함께 삭제 / 학생·루브릭은 프로젝트 종속 데이터로 독립 존재 의미가 없고, 프로젝트별 독립(혼입 방지) 설계이므로 프로젝트 삭제 = 전부 삭제가 맞다. DATA_MODEL의 on delete cascade와 일치.
- 2026-07-08 / (세션 4) owns_project(uuid) SECURITY DEFINER 헬퍼를 0003에서 신설 / DATA_MODEL 공통 규약에 예정됐으나 미작성 상태였음. students·rubrics RLS가 projects 소유 여부를 참조할 때 정책 재귀·성능을 위해 definer 함수로 캡슐화(is_admin/is_approved와 동일 패턴).
- 2026-07-08 / (세션 5) 프롬프트 팩의 submissions 스키마를 DATA_MODEL(SSOT)로 정합 + 확장 2건 / 팩의 `submission_ref/extracted_text/extraction_method/reflect`를 DATA_MODEL의 `submission_key/content_text/source_type/include_in_eval·include_in_record`로 매핑. 매칭(세션 6)에 필요한 `raw_student_no·raw_student_name`를 신규 추가, 매칭 전 스테이징을 위해 `match_status`에 `'unmatched'`(기본값) 추가. DATA_MODEL 8절 갱신.
- 2026-07-08 / (세션 5) 세션 5는 학생 매칭을 하지 않고 모든 파싱 행을 student_id NULL·match_status='unmatched'로 스테이징 / 세션 지시("파싱된 제출물 후보를 스테이징하는 데까지, 매칭은 세션 6")·혼입 방지. 잘못된 자동 귀속 경로를 원천 차단.
- 2026-07-08 / (세션 5) 스캔 PDF·이미지 OCR은 프로바이더 네이티브 비전으로 처리(서버 PDF→이미지 렌더링·canvas 의존 없음) / 사용자 확정. lib/llm의 LLMMessage.content를 `string | LLMContentPart[]`로 확장하고 어댑터 3종에 image/document 블록 매핑 추가. 스캔 PDF는 anthropic document 블록으로 직접 전달(기본 extract=claude-haiku가 PDF·이미지 입력 지원). 텍스트 레이어 추출은 unpdf(서버리스 pdfjs).
- 2026-07-08 / (세션 5) OCR 담당 프로바이더·모델 선택기를 세션 5에 제공(신규 VISION_MODELS 카탈로그: api_format별 OCR 가능 모델) / 사용자 지시("회사+해당 회사 OCR 가능 모델을 선택"). 선택값은 프로젝트 model_routing.extract에 저장 → 세션 4에서 세션 7로 이월한 라우팅 편집기의 extract 키 부분을 세션 5에서 실현. 세션 7은 evaluate/generate/verify 담당. 카탈로그 없는 커스텀 프로바이더는 자유 입력 폴백.
- 2026-07-08 / (세션 5) Storage 경로에 submission_id 대신 파일 단위 uuid 사용(`{owner}/{project}/{uuid}__{name}`) / 스프레드시트 1파일→다행 구조라 submission_id를 경로에 쓸 수 없음. DATA_MODEL Storage 주석 갱신.
- 2026-07-08 / (세션 5) 중복 감지는 하드 unique 제약이 아닌 애플리케이션 로직(조회용 인덱스만) + decideDedup 순수 함수 / 내용 변경 시 기존 행 유지 + pending_content 스테이징(update_pending)이 필요해 unique 제약과 상충. dedup 결정은 단위 테스트 가능한 순수 함수로 분리.
- 2026-07-08 / (세션 5) xlsx=SheetJS(`xlsx`)에 알려진 취약점 advisory 존재하나 SPEC 1절 지정 라이브러리·서버 측 교사 업로드 파싱이라 채택, 세션 9 QA에서 재검토 / SPEC이 SheetJS를 명시. next.config.serverExternalPackages로 xlsx·mammoth·unpdf를 런타임 외부화(번들 회피).
- 2026-07-08 / (세션 4) 프로젝트 설정 화면에 용도별 model_routing 편집 UI는 세션 4에서 만들지 않고 기본값 자동 조립(buildDefaultModelRouting)까지만 구현. 실제 LLM 파이프라인이 붙는 후속 세션(추천: 세션 7 Phase 2)에서 프로바이더·모델 선택 목록과 함께 구현 / 라우팅 편집은 `{provider_id, model}` 선택이 필요한데 현재 선택 가능한 모델 카탈로그가 없어(모델명이 자유 문자열) UX를 제대로 만들려면 프로바이더·모델 목록 정비가 선행돼야 함. 기본값(anthropic haiku/sonnet)이 조립되어 파이프라인은 동작하므로 기능 공백은 없음. SPEC 4절의 '모델 라우팅' 설정 항목은 데이터·기본값은 충족되고 편집 UI만 후속 배치되는 것으로, 세션 9 QA 시 SPEC 커버리지 점검에서 이 위임을 확인할 것. resolveApiKey가 routing.provider_id로 키를 고르므로, 비-anthropic 개인 키를 쓰는 교사를 위해 라우팅 편집이 실질적으로 필요해진다(단순 장식 아님).
