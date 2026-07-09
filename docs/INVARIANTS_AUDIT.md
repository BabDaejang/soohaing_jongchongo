# INVARIANTS_AUDIT — 불변 조건 최종 감사 (세션 9)

> 작성: 2026-07-10 (세션 9). 대상 커밋: `main` (세션 8b 완료 시점 + 세션 9 변경).
> SPEC 10절의 INV-1~6 각각이 **코드 어디서 어떻게 보장되는지** 파일·함수·RLS 정책 단위로 특정한다.
> 검증 방법: (a) 정적 코드 위치 지목, (b) 단위 테스트, (c) RLS 행위 테스트(pooler 경유 pg, 스크래치·미커밋),
> (d) 클라이언트 번들 스캔, (e) 실 LLM 라이브 1회(`docs/SMOKE_TEST.md`).

## 감사 방법과 한계

- **RLS 행위 테스트**: `.env.local`의 직접 DB 호스트(IPv6 전용)가 라우팅 불가하므로, 동일 비밀번호로
  IPv4 pooler(`postgres.<ref>@aws-1-ap-northeast-2.pooler.supabase.com:5432`, 세션 모드)를 구성해 실행했다.
  롤백 트랜잭션 안에서 임시 데이터를 시드하므로 **테스트 데이터는 영속하지 않는다**.
- **타 계정 시뮬레이션의 한계(명시)**: 현재 승인된 사용자가 **1명뿐**이라, "타 계정"은 실제 두 번째
  세션이 아니라 **임의 uuid를 `request.jwt.claims`의 `sub`로 주입**해 시뮬레이션했다(세션 8a·8b 방식 재사용).
  RLS 정책이 `auth.uid()`(= `request.jwt.claims`→sub)를 `owner_id`/`user_id`/`owns_project()`와 **비교**만
  하므로 이 방식은 소유·격리 축을 정확히 재현한다. 다만 **승인 게이트(`is_approved()`)에 의존하는 정책**은,
  임의 uuid에 `profiles` 행이 없어 `is_approved()=false`가 되는 성질로 확인했다(실제 미승인 2차 계정과
  동치). 실 브라우저 2계정 종단 확인(가입→승인 흐름)은 `docs/SMOKE_TEST.md`의 사용자 수행 구간으로 남긴다.
- **write 차단 판정 규칙**: `INSERT`의 `with_check` 위반은 `42501`로 거부되고, `UPDATE`/`DELETE`는 RLS
  `USING`이 대상 행을 숨겨 **0행 영향**으로 차단된다(둘 다 유효한 차단).

---

## INV-1 — 생기부 생성 호출 1회 = 학생 1명

정의: 생기부 생성 LLM 호출 1회에는 정확히 한 명의 학생 데이터만 포함된다. 일괄 생성도 내부는 학생별 순차 호출.

| 보장 지점 | 위치 | 방식 |
| --- | --- | --- |
| 컨텍스트 조립 함수가 **단일 studentId 시그니처** | `lib/records/context.ts:81` `buildStudentContext(studentId, source)` | 시그니처부터 학생 하나만 받는다. 학생 배열을 받는 생성 함수가 **존재하지 않는다**. |
| 생성 유일 진입점도 **단일 studentId** | `app/projects/[id]/records/actions.ts:90` `generateRecord(projectId, studentId)` | 서버에 `students[]`를 받는 생성 함수 없음. |
| 일괄 생성 = **클라이언트 순차 단일 호출** | `components/projects/records/*`(생성 패널) → `generateRecord` 반복 | 배치도 학생별 1호출(진행률 표시). 서버 배열 생성 경로 부재. |

검증:
- 단위 테스트 `tests/record-context.test.ts`: `buildStudentContext.length === 2`(studentId+source)로 시그니처 고정,
  가짜 2명 데이터 교차오염 테스트에서 A 컨텍스트에 B 미포함.
- 실 LLM 라이브(세션 9): 두 학생 각각 생성 시 컨텍스트 `본인 제출물만 = true`(SMOKE_TEST).

---

## INV-2 — 생성 컨텍스트는 서버가 student_id 필터로만 조립

정의: 컨텍스트는 서버가 `student_id` 필터로 DB에서 직접 조립. 클라이언트가 임의 텍스트를 주입 불가(교사 메모는 해당 학생 레코드 귀속분만 예외).

| 보장 지점 | 위치 | 방식 |
| --- | --- | --- |
| 제출물 조회가 **`student_id` 필터로만** | `lib/records/context.ts:124-132` `listStudentSubmissions` | `.eq("student_id", studentId)` 단일 조건. 구조적 INV-2. |
| **방어적 재필터**(코드 레벨 2차 방어) | `lib/records/context.ts:34-50` `filterRecordSubmissions` | 소스가 버그로 타 학생 행을 반환해도 `s.student_id === studentId && include_in_record && 매칭확정`만 통과. |
| 교사 메모는 **해당 학생 레코드 귀속분만** | `lib/records/context.ts:116-123` `getStudent` → `students.teacher_memo` | 학생 행에 귀속된 메모만. 클라이언트 임의 텍스트 주입 경로 없음. |
| DB 계층 격리(RLS) | `submissions_select`(owns_project), `students`·`prompt_profiles` RLS | 소유 프로젝트/본인 프로필만 조회 가능(아래 RLS 표). |

검증:
- 단위 테스트 `tests/record-context.test.ts`: "타 학생 데이터 미포함(INV-2)", "버그로 소스가 전체를 반환해도 방어적 재필터로 A만".
- 실 LLM 라이브(세션 9): 컨텍스트 `본인 제출물만 = true`, `sources` = 본인 제출물 id.

---

## INV-3 — 생성 결과에 근거 제출물 id 목록(sources) 저장

| 보장 지점 | 위치 | 방식 |
| --- | --- | --- |
| `sources`에 사용 제출물 id 배열 저장 | `app/projects/[id]/records/actions.ts:144` | `sources: validIds`(= 컨텍스트 제출물 id). |
| **generated 행 insert는 service role 전용** | `actions.ts:132-150`(admin 클라이언트로 insert) | 생성/검증 결과 위조 차단. |
| RLS가 authenticated의 generated 위조 차단 | `supabase/migrations/0007_records_profiles.sql:48-54` `records_insert_teacher` | authenticated insert는 `origin in ('edited','manual')`만 허용 → **generated 제외**. |

검증:
- RLS 행위 테스트(세션 9): 소유자 세션 `origin='generated'` insert → **42501 거부**, `origin='edited'` insert → 허용, 타 계정 insert → 42501.
- 실 LLM 라이브: `records.sources` 채워짐 = true, `origin=generated`·`model` 기록됨.

---

## INV-4 — LLM API 키는 서버 전용, 클라이언트 노출 금지

| 보장 지점 | 위치 | 방식 |
| --- | --- | --- |
| 암복호화 모듈 **server-only** | `lib/crypto/index.ts:1` `import "server-only"` | 클라이언트 번들 유입 시 빌드 실패. AES-256-GCM(`encrypt`/`decrypt`). |
| 키 해석 모듈 server-only | `lib/llm/keys.ts:1` + `resolveApiKey`(38) | service role로 키 조회 + 서버 복호화. |
| LLM 클라이언트 server-only | `lib/llm/index.ts:1` + `callLLM`(48) | 프로바이더 호출은 서버에서만. |
| service role 클라이언트 server-only | `lib/supabase/admin.ts:1` | RLS 우회 클라이언트를 서버로 한정. |
| `encrypted_key` 클라이언트 미노출 | `api_keys` RLS + 화면은 `key_last4`만 | 개인/기본 키 격리(RLS 표). |

검증:
- **클라이언트 번들 스캔(세션 9, `next build` 후 `.next/static`)**: `service_role`(base64 `c2VydmljZV9yb2xl`)·service role JWT
  서명·`createDecipheriv`·`aes-256-gcm`·`APP_ENCRYPTION_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`encrypted_key` → **0건**.
  공개 값(Supabase URL)만 정상 노출.
- 단위 테스트 `tests/crypto.test.ts`(왕복·IV 무작위·변조 감지), `tests/resolve-api-key.test.ts`(개인>기본>에러).
- 실 LLM 라이브(세션 9): 키 `encrypt` 저장(암호문≠평문) → `resolveApiKey` → `decrypt` → `callLLM` 종단 경로 실동작, 화면 표시는 `last4`만.

---

## INV-5 — 원본 파일 삭제는 교사의 추출 확인(승인) 이후에만

| 보장 지점 | 위치 | 방식 |
| --- | --- | --- |
| 수동 삭제 액션 가드 | `app/projects/[id]/submissions/actions.ts:398-413` `deleteOriginal` | `if (!sub.extraction_approved_at) throw`(408) — 미승인이면 거부. |
| 자동 삭제 자격 순수 함수 | `lib/retention.ts:6` `isPurgeEligible` | 미승인(`extraction_approved_at` null) → **항상 false**, 정책 꺼짐(null) → false. |
| 자동 삭제 배치가 승인분만 대상 | `lib/originals.ts:28` `purgeExpiredOriginals` | 쿼리에서 `extraction_approved_at IS NOT NULL`만 조회(47) + `isPurgeEligible` 재확인(51). |
| 공유 원본 안전 삭제 | `lib/originals.ts:11` `deleteOriginalObject` | 같은 `storage_path` 참조 제출물이 남아있으면 객체 유지. |

검증:
- 단위 테스트 `tests/retention.test.ts`: 미승인 always false, 정책 꺼짐 false, N일 경과 경계.
- Cron 라우트 `app/api/cron/purge-originals/route.ts`는 `CRON_SECRET` Bearer 인증(미설정 시 503, 불일치 401).

---

## INV-6 — 등급은 저장된 점수에서 파생 계산, 직접 저장·수정 금지

| 보장 지점 | 위치 | 방식 |
| --- | --- | --- |
| `student_scores`·`evaluations` write는 **service role 배치만** | `supabase/migrations/0006_evaluations_scores.sql` RLS | 두 테이블에 **select 정책만** 존재(insert/update/delete 정책 부재) → authenticated 쓰기 불가. |
| 재계산 배치가 유일 write 경로 | `app/projects/[id]/evaluate/actions.ts:94` `recomputeAndSave`(admin 클라이언트) | 합성·순위·등급을 재계산해 스냅샷 저장. |
| 등급은 **파생 계산**(저장값 아님) | `lib/grading.ts` `computeStandings`/`deriveGrade` | 배치·클라이언트 공용 순수 함수. 등급제(5/9) 토글은 재계산 없이 파생 표시. |
| 등급 직접 수정 UI/API **없음** | 코드 전반 | 교사 개입은 `students.score_override`(사유 필수, 감사 로그)뿐 → 순위·등급 재계산 트리거. |

검증:
- RLS 행위 테스트(세션 9): 소유자 세션 `evaluations`·`student_scores` insert → **42501 거부**(service role만 write).
- 단위 테스트 `tests/grading.test.ts`(누적 비율·동점·경계), `tests/scoring.test.ts`(결정성).
- 실 LLM 라이브(세션 9): 채점→합성→순위→등급이 `student_scores` 스냅샷으로만 저장, 등급은 `computeStandings` 파생.

---

## RLS 전수 점검 결과 (세션 9)

15개 테이블 + Storage `originals`(storage.objects 정책 4종) = **16/16 PASS**. 모든 테이블 RLS 활성화 확인.
소유자 열람 가능 + 타 계정 열람 0행 + 타 계정 쓰기 차단, 그리고 긍정 케이스(소유자 열람·`edited` insert·자기 폴더 storage insert)도 통과해 blanket-deny가 아님을 입증.

| 테이블 | 소유자 열람 | 타 계정 열람 | 타 계정 쓰기 | 비고 |
| --- | --- | --- | --- | --- |
| profiles | 전체(admin) | 0 | update 0행(권한상승 차단) | 본인/admin select |
| app_settings | 가능 | **가능(의도적)** | update 차단 | 대기화면용 전역 select, write admin 전용 |
| providers | 3(승인자) | 0(미승인) | insert 42501 | 승인자만 열람, admin write |
| api_keys | 개인+기본 | 0 | insert 42501 | INV-4: 개인/기본 격리 |
| audit_logs | 가능(admin) | 0 | insert 42501 | insert service role 전용 |
| projects | 소유분 | 0 | insert 42501 | owns_project 축 |
| students | 소유분 | 0 | insert 42501 | owns_project |
| rubrics | 소유분 | 0 | insert 42501 | owns_project |
| submissions | 소유분 | 0 | insert 42501 | owns_project |
| evaluations | 소유분 | 0 | insert 42501(소유자도) | **INV-6** service role write |
| student_scores | 소유분 | 0 | insert 42501(소유자도) | **INV-6** service role write |
| records | 소유분 | 0 | generated 42501/edited 허용/타계정 42501 | **INV-3** generated는 service role만 |
| prompt_profiles | 소유분 | 0 | insert 42501 | owner 축 |
| prompt_profile_versions | 소유분 | 0 | insert 42501, update 0행 | owner 축, append-only |
| ui_layouts | 소유분 | 0 | insert 42501 | user_id 축 + is_approved write |
| storage.objects(originals) | 소유 경로 | 0 | 타 폴더 insert 42501 / 자 폴더 insert 허용 / 타 객체 delete 0행 | 경로 첫 세그먼트=auth.uid() |

> 스크립트는 스크래치에서 실행하고 저장소에 커밋하지 않는다(기존 관례). 재현: pooler 접속 후
> 롤백 트랜잭션 안에서 전 체인 시드 → `set local role authenticated` + `request.jwt.claims` 전환으로 소유자/타 계정 대조.
