# SMOKE_TEST — 통합 스모크 시나리오 (세션 9)

> 전 구간 시나리오: **가입 → 대기 → 관리자 승인 → 프로젝트 생성 → 파일 업로드·매칭 → 평가·등급 →
> 생기부 생성·검증 → 표 편집 → 재로그인 레이아웃 복원.**
> 구간을 셋으로 나눈다: **[A] 에이전트 자동 수행**, **[B] 브라우저 — 사용자 수행 체크리스트**,
> **[C] 실 LLM 라이브(에이전트, 라이브 1회 완료)**. 수행하지 않은 구간을 통과처럼 표기하지 않는다.

수행일: 2026-07-10 (세션 9). 대상: Supabase `pqzcviurfjzsgkmaprqe`, 로컬 build/pg.

---

## [A] 에이전트 자동 수행 — 결과

| 항목 | 방법 | 결과 |
| --- | --- | --- |
| typecheck | `npm run typecheck` (tsc --noEmit) | ✅ 통과 |
| lint | `npm run lint` (eslint) | ✅ 통과(경고 0) |
| 단위 테스트 | `npm test` (node:test + tsx, 16파일) | ✅ **76/76 통과** |
| production build | `npm run build` (Next 16 turbopack) | ✅ 통과(19 라우트) |
| 클라이언트 번들 스캔 | `.next/static` grep(service role·복호화·평문 키 마커) | ✅ **0건**(INV-4) |
| RLS 전수 점검 | pooler pg, 15테이블+storage 4정책, JWT 시뮬 | ✅ **16/16 PASS**(`docs/INVARIANTS_AUDIT.md`) |
| SheetJS advisory | `npm audit` 재검토 → CDN 0.20.3 업그레이드 | ✅ high 2건 해소(`docs/DECISIONS.md`) |

> build 시 로컬에서 "multiple lockfiles" 경고가 뜨지만 이는 상위 폴더의 `C:\Users\gram\package-lock.json`
> 때문이며 Vercel(격리 배포)에는 없다. 필요 시 `next.config.ts`에 `turbopack.root` 지정으로 무음화 가능.

---

## [B] 브라우저 구간 — 사용자 수행 체크리스트

에이전트는 실제 Google OAuth 로그인·가입→승인 흐름을 수행할 수 없다(2번째 Google 계정 필요). 아래를
순서대로 수행하고 각 결과를 기록해 주세요. (배포 전 최소 1회, 또는 로컬 `npm run dev`로 수행 가능.)

사전 준비: `.env.local`/Vercel 환경변수 설정 완료, Supabase Google 프로바이더 활성화, 마이그레이션 적용(README 참조).

| # | 단계 | 기대 결과 | 결과(기록) |
| --- | --- | --- | --- |
| 1 | 관리자 계정(`ADMIN_EMAIL`)으로 Google 로그인 | 콜백에서 admin·approved 자동 승격 → `/`(프로젝트 목록) 진입 | ⬜ |
| 2 | **2번째 Google 계정**(교사 역)으로 로그인 | `profiles` pending 생성 → `/waiting`(대기 안내문) 표시, 앱 기능 차단 | ⬜ |
| 3 | 대기 계정으로 `/`·`/projects`·`/admin` 직접 URL 접근 | 모두 `/waiting`로 리다이렉트(proxy 게이트) | ⬜ |
| 4 | 관리자 `/admin`에서 대기 계정 **승인** | 목록에서 상태 approved 전환, audit 기록 | ⬜ |
| 5 | 관리자 `/admin`에서 대기 안내문(waiting_message) 편집 | 저장 후 대기 계정 새로고침 시 반영 | ⬜ |
| 6 | 관리자 `/admin`에서 프로바이더별 **기본 키 등록**(끝 4자리 마스킹 확인) | 저장·마스킹 표시, 평문 미표시 | ⬜ |
| 7 | 승인된 교사 계정으로 재로그인 | `/`(프로젝트 목록) 정상 진입 | ⬜ |
| 8 | 교사: 프로젝트 생성 → 설정(등급제·글자수·합성 등) 저장/재로드 | 왕복 정상 | ⬜ |
| 9 | 교사: `/account`에서 개인 API 키 등록/삭제 | 마스킹 표시, 개인 키 우선 적용 | ⬜ |
| 10 | 교사: 파일 업로드(xlsx/csv/docx/pdf) → 열 매핑 → 스테이징 | 제출물 후보 생성(추출 텍스트) | ⬜ |
| 11 | 교사: 매칭 실행 → 확인 큐(이름만 일치는 자동 병합 안 됨 확인) → 확정 | 학번 일치만 자동, 이름만은 확인 큐 | ⬜ |
| 12 | 교사: 추출 확인 후 원본 삭제(확인 전 삭제 버튼 비활성 확인) | INV-5: 승인 전 삭제 불가 | ⬜ |
| 13 | 교사: 평가 실행 → 등급 분포·순위 확인, 등급제 5/9 토글 즉시 반영 | 파생 등급 즉시 전환 | ⬜ |
| 14 | 교사: 생기부 생성·검증(미근거 문장 하이라이트) → 표 편집(열 너비·셀 모드) | 생성/검증/편집 동작 | ⬜ |
| 15 | 교사: 표 레이아웃 변경 후 **로그아웃 → 재로그인** | 동일 레이아웃 복원(ui_layouts) | ⬜ |

> 13~14의 실 LLM 호출은 유효 API 키가 필요하다(6·9단계로 등록). 소량 데이터 권장.

---

## [C] 실 LLM 라이브 1회 — 결과 (에이전트 수행, 2026-07-10)

사용자 사전 승인(2026-07-10) 하에 **OpenAI 키로 라이브 1회** 수행. 임시 프로젝트+학생 2명을 service role로
시드해 실제 lib 파이프라인(`callLLM`·프롬프트 빌더·`buildStudentContext`·파서·저장)을 구동하고, 결과 검증 후
**임시 데이터·등록 키를 모두 삭제**했다(미영속). 서버 액션의 auth 가드(`requireProjectOwner`)만 우회했고
LLM 호출·키 해석·응답 파싱·DB 저장 경로는 실제 코드다.

- 모델: `gpt-4o-mini`(프로젝트 model_routing로 전 purpose를 openai로 지정), 호출 6회(평가 2·생성 2·검증 2).
- **키 경로(INV-4)**: `encrypt` 저장(암호문 256자, 평문≠암호문) → `resolveApiKey`(개인 키) → `decrypt` → `callLLM`. 화면 표시는 `last4`만.
- **평가(Phase 2)**: JSON 응답 파싱 정상(기준 점수 5,4 / total 9), `evaluations` 저장 → 합성·순위·등급 파생 → `student_scores` 저장(2행).
- **생성(Phase 3, INV-1/2/3)**: 각 학생 컨텍스트 `본인 제출물만 = true`, `sources` = 본인 제출물 id, `teacher_memo_used` 정확, `origin=generated`(service role).
- **검증**: 문장 단위 근거 판정 파싱 정상. 근거 없는 문장 플래그 동작(예: 학생나 초안의 "지역 사회에 기여하고자 하는 동기" 문장 → grounded=false로 감지).
- **저장 재조회**: evaluations=2, student_scores=2, records=2, 내용 비어있지 않음·sources 채워짐·origin=generated·model 기록 모두 확인.
- **정리**: 임시 프로젝트 cascade 삭제(잔존 0), 등록 키 삭제.
- **결과: PASS ✅**

관찰(파이프라인 결함 아님): `gpt-4o-mini`는 문체 규칙(`-함/-임/-됨`, 인칭 미표기)을 완전히 지키지는 않았다.
이는 모델 품질 문제이며 기본 라우팅은 claude-sonnet-4-6이다. 실사용 시 생성/검증 모델은 프로젝트 설정에서 조정 가능.

⚠️ **키 회전 권고**: 라이브에 쓴 OpenAI 키는 대화에 평문 노출되었으므로 폐기·재발급하고, 새 키를 `/admin`(기본 키)
또는 `/account`(개인 키)에서 등록하세요. 라이브 후 등록 키는 삭제되어 DB에 남아있지 않습니다.
