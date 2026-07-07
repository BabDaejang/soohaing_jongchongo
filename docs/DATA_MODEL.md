# DATA_MODEL — 데이터 모델 설계

> SPEC.md 9절의 테이블 목록을 구체화한 문서. 스키마 변경은 이 문서를 먼저 갱신하고 마이그레이션을 작성한다.
> 실제 마이그레이션 SQL은 세션 1 이후 `supabase/migrations/`에 작성하며, 이 문서와 충돌 시 이 문서가 우선한다(충돌 발견 시 DECISIONS.md에 기록).

## 공통 규약

- PK는 `id uuid primary key default gen_random_uuid()` (profiles 제외 — auth.users의 id를 그대로 사용).
- 모든 테이블에 `created_at timestamptz not null default now()`. 갱신되는 테이블에는 `updated_at timestamptz` + 트리거.
- enum은 Postgres `enum` 타입 대신 `text + check` 제약을 사용한다 (마이그레이션 유연성).
- **RLS는 모든 테이블에서 활성화**한다. 정책이 없는 테이블은 곧 접근 불가를 의미한다.
- 승인된 사용자 판별 헬퍼: `is_approved()` — `profiles.status = 'approved'`인 본인 여부. 관리자 판별: `is_admin()`. (SECURITY DEFINER 함수로 구현, 세션 2에서 작성)
- 프로젝트 소유 판별 헬퍼: `owns_project(project_id)` — `projects.owner_id = auth.uid()`.

## 관계 개요

```text
auth.users 1─1 profiles
profiles 1─N projects (owner)
profiles 1─N api_keys (owner, NULL이면 관리자 등록 기본 키)
providers 1─N api_keys
projects 1─N students / submissions / rubrics / records / ui_layouts
projects 1─1 student_scores 계산 배치 (학생별 1행)
students 1─N submissions (매칭 확정 전에는 submissions.student_id NULL)
submissions 1─N evaluations (재채점 시 새 행)
students 1─N records (버전별 1행)
profiles 1─N prompt_profiles (project_id NULL = 계정 기본)
```

## 1. profiles — 사용자 프로필·승인 상태

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK, FK → auth.users(id) on delete cascade | Supabase Auth 사용자와 1:1 |
| email | text | not null | Google 계정 이메일 (표시용 사본) |
| name | text | | Google 프로필 이름 |
| role | text | not null, check in ('admin','user'), default 'user' | 최초 1인만 admin (시드) |
| status | text | not null, check in ('pending','approved','rejected'), default 'pending' | 가입 = pending 자동 생성 |
| created_at | timestamptz | not null default now() | |
| updated_at | timestamptz | | |

- 생성: 최초 Google 로그인 시 DB 트리거(`on auth.users insert`)로 자동 생성 (SPEC 2절).
- **RLS**: 본인 행 select 가능(status 확인용). role·status 컬럼은 본인이 수정 불가 — update 정책은 admin 전용. admin은 전체 select/update/delete.
- 삭제: 관리자의 "삭제"는 auth.users 삭제 → cascade.

## 2. app_settings — 전역 설정 (key-value)

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| key | text | PK | 예: `waiting_message` |
| value | jsonb | not null | 값 (문자열도 jsonb로 감싼다) |
| updated_at | timestamptz | | |
| updated_by | uuid | FK → profiles(id) | |

- 초기 시드: `waiting_message` (미승인 사용자 대기 화면 안내문).
- **RLS**: select는 인증된 사용자 전체(대기 화면은 미승인 사용자도 봐야 함), insert/update/delete는 admin 전용.

## 3. providers — LLM 프로바이더

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| name | text | not null, unique | 표시명 (시드: google, anthropic, openai) |
| base_url | text | | NULL이면 API 형식의 기본 엔드포인트 |
| api_format | text | not null, check in ('anthropic','openai','google') | 요청/응답 형식 |
| is_seed | boolean | not null default false | 시드 3종은 삭제 금지 |
| created_at | timestamptz | not null default now() | |

- **RLS**: select는 승인된 사용자 전체(개인 키 등록 화면에서 필요), insert/update/delete는 admin 전용. `is_seed = true` 행은 delete 정책에서 제외.

## 4. api_keys — 암호화된 API 키 (INV-4)

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| provider_id | uuid | not null, FK → providers(id) on delete cascade | |
| owner_id | uuid | FK → profiles(id) on delete cascade, **NULL 허용** | NULL = 관리자 등록 기본 키 |
| encrypted_key | text | not null | AES-256-GCM 암호문 (iv·tag 포함 인코딩). 키는 env `APP_ENCRYPTION_KEY` |
| key_last4 | text | not null | 마스킹 표시용 끝 4자리 |
| created_at | timestamptz | not null default now() | |
| updated_at | timestamptz | | |

- unique 제약: `(provider_id, owner_id)` — 사용자당 프로바이더별 1키. 기본 키(owner_id NULL)도 프로바이더별 1키 (partial unique index `where owner_id is null`).
- 키 해석 순서(서버 전용 로직): 개인 키 존재 → 개인 키, 없으면 기본 키.
- **RLS**: 개인 키는 본인만 CRUD. 기본 키(owner_id NULL)는 admin만 CRUD. **`encrypted_key` 컬럼은 클라이언트 쿼리에 절대 노출하지 않는다** — select 정책은 두되, 클라이언트용 뷰/쿼리는 `key_last4`만 반환하고 복호화는 서버(service role 또는 Server Action)에서만 수행.
- 평문 저장·로그 출력 금지 (SPEC 3절).

## 5. projects — 수행평가 단위

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| owner_id | uuid | not null, FK → profiles(id) on delete cascade | 프로젝트 소유 교사 |
| name | text | not null | |
| grading_scheme | text | not null, check in ('grade5','grade9'), default 'grade5' | 5등급/9등급 토글 |
| char_limit | integer | not null default 500 | 생기부 글자수 제한 |
| count_method | text | not null, check in ('chars','bytes'), default 'chars' | 글자수(공백 포함)/바이트(한글 3바이트) |
| score_aggregation | text | not null, check in ('sum','avg','weighted'), default 'avg' | 합성 점수 방식 |
| tie_break | text | not null, check in ('best_grade','mid_rank'), default 'best_grade' | 동점자 처리 (best_grade = 상위 등급 부여) |
| file_retention_days | integer | check in (null 또는 7, 30) | NULL = 자동 삭제 끄기(기본) |
| model_routing | jsonb | not null default 시드값 | `{extract, evaluate, generate, verify}` → `{provider_id, model}`. 기본: extract=claude-haiku-4-5, 나머지=claude-sonnet-4-6 |
| needs_recalc | boolean | not null default false | 신규 제출물·체크박스 변경 시 true → "재계산 필요" 배지 (SPEC 6절) |
| created_at / updated_at | timestamptz | | |

- **RLS**: `owner_id = auth.uid()` and 승인됨 — 전 작업. 교사 간 공유 기능은 스펙에 없으므로 없음.

## 6. rubrics — 평가 루브릭

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| project_id | uuid | not null, FK → projects(id) on delete cascade | |
| criteria | jsonb | not null | 기준 배열: `[{id, name, description, max_score, weight}]`. weight는 score_aggregation='weighted'일 때 사용 |
| created_at / updated_at | timestamptz | | |

- 프로젝트당 1행(unique project_id)으로 시작. 기준 추가/수정은 jsonb 갱신.
- 루브릭 변경 시 `projects.needs_recalc = true`.
- **RLS**: 프로젝트 소유자만 (owns_project 경유).

## 7. students — 학생 (프로젝트 종속)

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| project_id | uuid | not null, FK → projects(id) on delete cascade | 학생은 프로젝트 간 공유하지 않음 (혼입 방지 — 프로젝트별 독립) |
| student_number | text | | 학번. unique `(project_id, student_number)` (NULL 제외 partial) |
| name | text | not null | |
| teacher_memo | text | | 교사 개인 관찰 메모 (SPEC 7.4) — 이 학생 레코드에 귀속 (INV-2 예외 경로) |
| score_override | numeric | | 교사 개입 점수 (SPEC 6절). NULL = 미사용 |
| override_reason | text | | **score_override가 NOT NULL이면 필수** (check 제약: 둘 다 NULL이거나 둘 다 NOT NULL) |
| created_at / updated_at | timestamptz | | |

- 자동 생성은 "학번 신규 검출" 시에만 (SPEC 5.2-d). 그 외 신규 생성은 교사 확인 UI 경유.
- score_override 변경은 audit_logs에 기록.
- **RLS**: 프로젝트 소유자만.

## 8. submissions — 제출물

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| project_id | uuid | not null, FK → projects(id) on delete cascade | |
| student_id | uuid | FK → students(id) on delete set null, **NULL 허용** | 매칭 확정 전 NULL. **NULL이면 평가·생성 컨텍스트에서 절대 제외** |
| submission_key | text | | 시트의 제출물ID 열 값. 중복 감지 키 `(student식별값 + submission_key)` |
| content_text | text | not null | 추출·정제된 텍스트 (DB에는 이것만 저장 — SPEC 5.3) |
| content_hash | text | not null | 정규화 텍스트 SHA-256 — 재업로드 중복·변경 감지 |
| source_type | text | not null, check in ('xlsx','csv','docx','pdf_text','pdf_scan','image','manual') | |
| source_filename | text | | 원본 파일명 |
| storage_path | text | | Storage 임시 버킷 경로. 삭제 후 NULL |
| match_status | text | not null, check in ('auto_matched','pending_confirm','confirmed','update_pending') | (a)학번 일치=auto_matched / (b)(c)=pending_confirm / 교사 확정=confirmed / 재업로드 내용 변경=update_pending |
| match_candidates | jsonb | | 확인 대기 큐용 후보: `[{student_id, reason}]` (LLM 제안 포함) |
| pending_content | jsonb | | update_pending일 때 새 내용·해시 보관 (교사 승인 전 원본 유지 — 자동 덮어쓰기 금지) |
| include_in_eval | boolean | not null default true | 평가 반영 체크박스 |
| include_in_record | boolean | not null default true | 생기부 반영 체크박스 |
| extraction_approved_at | timestamptz | | 교사의 추출 품질 승인 시각. **NULL이면 원본 파일 삭제 금지 (INV-5)** — 자동 삭제(N일)도 이 조건을 우선한다 |
| created_at / updated_at | timestamptz | | |

- 중복 감지 로직: 업로드 시 `(project_id, 학생 식별값, submission_key)`로 기존 행 조회 → content_hash 동일하면 스킵, 다르면 `match_status='update_pending'` + pending_content에 보관.
- **RLS**: 프로젝트 소유자만. Storage 버킷도 소유자 경로 기반 정책(`{project_id}/...`).

## 9. evaluations — 제출물 단위 LLM 채점

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| submission_id | uuid | not null, FK → submissions(id) on delete cascade | |
| project_id | uuid | not null, FK → projects(id) on delete cascade | 조회 편의 + RLS |
| scores | jsonb | not null | 기준별: `[{criterion_id, score, evidence_quote}]` — 근거 인용 필수 (SPEC 6절) |
| total_score | numeric | not null | 기준 점수 합산 (루브릭 배점 기준) |
| raw_llm_output | text | not null | 감사용 LLM 원문 출력 보관 |
| model | text | not null | 사용 모델 식별자 |
| is_current | boolean | not null default true | 재채점 시 이전 행 false — 이력 보존 |
| created_at | timestamptz | not null default now() | |

- 재채점은 update가 아닌 insert (감사 이력). `(submission_id, is_current=true)` partial unique.
- **RLS**: 프로젝트 소유자 select만. **insert/update는 서버(service role) 전용** — 채점 결과는 클라이언트가 위조할 수 없다.

## 10. student_scores — 학생별 합성 점수·순위·등급 (INV-6)

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| project_id | uuid | not null, FK → projects(id) on delete cascade | |
| student_id | uuid | not null, FK → students(id) on delete cascade, unique `(project_id, student_id)` | |
| composite_score | numeric | not null | 합성 점수 (합/평균/가중 — 프로젝트 설정) |
| effective_score | numeric | not null | `coalesce(students.score_override, composite_score)` 스냅샷 — 순위 산출에 사용 |
| rank | integer | not null | 전체 순위 (동점 처리 반영) |
| grade | integer | not null | 파생 등급 (누적 비율 매핑 결과) |
| calculated_at | timestamptz | not null | 계산 배치 시각 |

- **INV-6 강제**: 이 테이블은 **서버 재계산 배치만 쓴다**. RLS에서 소유자는 select만, insert/update/delete는 service role 전용. 등급을 직접 수정하는 API·UI를 만들지 않는다. grade는 저장하되 "재계산의 산출 스냅샷"이며, 등급제 토글 시 화면 즉시 반영은 저장값이 아닌 **rank + 등급 매핑표로 클라이언트 파생 표시**로 구현 (재계산 없이 토글 가능).
- 교사 개입은 `students.score_override`(사유 필수) → 재계산 트리거 경로만.

## 11. records — 생기부 (버전 관리, INV-1~3)

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| project_id | uuid | not null, FK → projects(id) on delete cascade | |
| student_id | uuid | not null, FK → students(id) on delete cascade | 정확히 한 학생에 귀속 (INV-1) |
| version | integer | not null | unique `(student_id, version)`, 재생성·수정 시 +1 |
| content | text | not null | 생기부 본문 |
| sources | uuid[] | not null | 근거 제출물 id 목록 (INV-3). 수동 작성 버전은 빈 배열 허용 |
| teacher_memo_used | boolean | not null default false | 생성 컨텍스트에 교사 메모 포함 여부 (감사) |
| verification | jsonb | | 검증 패스 결과: `[{sentence, grounded, source_submission_ids}]` — grounded=false 문장이 UI 하이라이트 대상 |
| model | text | | 생성 모델 (수동 편집 버전은 NULL) |
| origin | text | not null, check in ('generated','edited','manual') | 버전 출처 |
| is_current | boolean | not null default true | `(student_id, is_current=true)` partial unique |
| created_at | timestamptz | not null default now() | |

- 생성은 **서버 전용**: 컨텍스트는 서버가 `student_id` 필터로 DB에서 직접 조립 (INV-2). 일괄 생성도 학생별 순차 호출 (INV-1).
- **RLS**: 소유자 select. **generated/verification의 insert는 service role 전용**, 교사 편집(edited 버전 insert)은 소유자 허용.

## 12. prompt_profiles — 프롬프트 프로필 (계정 기본 + 프로젝트 오버라이드)

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| owner_id | uuid | not null, FK → profiles(id) on delete cascade | 계정별 관리 |
| project_id | uuid | FK → projects(id) on delete cascade, **NULL 허용** | NULL = 계정 기본 프로필, NOT NULL = 프로젝트 오버라이드 |
| guidelines | jsonb | not null default '[]' | 작성 참고사항 목록: `[{id, text}]` |
| prohibitions | jsonb | not null default '[]' | 금지사항 목록: `[{id, text}]` |
| created_at / updated_at | timestamptz | | |

- unique: `(owner_id, project_id)` (project_id NULL 포함 — partial unique 2개).
- 시드(계정 최초 생성 시): 문체 기본값 — 종결어미 '-함/-임/-됨', 학생 성명·인칭대명사 미표기 (SPEC 7.5).
- 예시 생기부 인제스트: LLM diff 제안은 저장하지 않고 UI 상태로만, 교사 승인 항목만 이 테이블에 반영 (자동 반영 금지).
- **RLS**: `owner_id = auth.uid()`만.

## 13. ui_layouts — 결과 표 레이아웃 저장

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| user_id | uuid | not null, FK → profiles(id) on delete cascade | |
| project_id | uuid | not null, FK → projects(id) on delete cascade | |
| layout | jsonb | not null | 열 너비, 행별 표시 모드(접기/전체/커스텀 높이), 전체 토글 상태 |
| updated_at | timestamptz | not null default now() | |

- unique `(user_id, project_id)`. 저장은 디바운스 upsert, 재로그인 시 복원 (SPEC 8절).
- **RLS**: `user_id = auth.uid()`만.

## 14. audit_logs — 감사 로그 (append-only)

| 컬럼 | 타입 | 제약 | 설명 |
| --- | --- | --- | --- |
| id | uuid | PK | |
| actor_id | uuid | FK → profiles(id) on delete set null | 행위자 |
| action | text | not null | 예: `score_override.set`, `score_override.clear`, `submission.delete`, `original_file.delete`, `profile.approve`, `api_key.set` |
| entity | text | not null | 대상 테이블명 |
| entity_id | uuid | | 대상 행 |
| detail | jsonb | | 사유·변경 전후 값 등 (API 키 평문 절대 금지) |
| created_at | timestamptz | not null default now() | |

- **RLS**: insert는 서버 전용(service role). select는 admin + (자기 프로젝트 관련 행은 소유자). update/delete 정책 없음 — append-only.

## Storage (테이블 아님)

- 버킷 `originals` (비공개): 원본 파일 임시 보관. 경로 `{owner_id}/{project_id}/{submission_id}/{filename}`.
- 정책: 경로 첫 세그먼트 = auth.uid()인 소유자만 read/write.
- 삭제 조건: 해당 submission의 `extraction_approved_at IS NOT NULL` (INV-5). 자동 삭제(N일) 배치도 동일 조건 필수.
