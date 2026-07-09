# 수행평가 수합·평가·생기부 생성 웹앱 (soohaing_jongchongo)

대한민국 고등학교 교사가 학생 수행평가 산출물을 수합·평가하고 학교생활기록부(생기부) 서술을 생성하는 웹앱.

**최우선 요구사항 두 가지**: ① 학생 간 데이터 혼입 절대 금지, ② 산출물에 근거하지 않은 서술(할루시네이션) 금지.
설계·불변 조건의 단일 진실 원천은 [`docs/SPEC.md`](docs/SPEC.md)이며, 불변 조건(INV-1~6)의 코드 보장 지점은
[`docs/INVARIANTS_AUDIT.md`](docs/INVARIANTS_AUDIT.md)에 정리되어 있다.

## 기술 스택

- **Next.js 16**(App Router, TypeScript strict) + **Tailwind CSS v4**, 배포 **Vercel**
- **Supabase**: Auth(Google OAuth), Postgres(**RLS 필수**), Storage(원본 임시 보관)
- **LLM 호출은 전부 서버 측**(Route Handler / Server Action). API 키는 서버 전용, 클라이언트 노출 금지(INV-4)
- 파일 파싱: SheetJS(xlsx)·papaparse(csv)·mammoth(docx)·unpdf(pdf 텍스트) + LLM 비전 OCR(스캔본)

---

## 1. 사전 요구사항

- Node.js 20+ / npm
- [Supabase](https://supabase.com) 프로젝트 1개(무료 플랜 가능)
- Google Cloud OAuth 클라이언트(웹) — email·profile 기본 스코프만(민감 스코프 없음 → 앱 검증 불필요)
- (배포 시) Vercel 계정, [Supabase CLI](https://supabase.com/docs/guides/cli)(마이그레이션 적용용)

---

## 2. 환경변수 체크리스트

`.env.example`를 `.env.local`로 복사해 채운다. `.env*`는 `.gitignore`로 커밋이 차단된다(시크릿 보호, INV-4).

| 변수 | 용도 | 획득처 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL(공개) | 대시보드 → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon 공개 키 | 대시보드 → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **서버 전용** service role 키(RLS 우회) | 대시보드 → Settings → API — 클라이언트 노출 금지 |
| `APP_ENCRYPTION_KEY` | API 키 AES-256-GCM 암호화(base64 32바이트) | `openssl rand -base64 32` |
| `ADMIN_EMAIL` | 최초 관리자로 자동 승격할 Google 이메일 | 운영자 계정 |
| `CRON_SECRET` | 원본 자동 삭제 Cron 보호 시크릿 | `openssl rand -hex 32` |
| `SUPABASE_DB_URL` | 마이그레이션 적용용 DB 연결(**CLI 전용**, 앱 미사용) | 대시보드 → Settings → Database |

> Google OAuth 클라이언트 ID/시크릿은 **앱 환경변수가 아니라** Supabase 대시보드(Authentication →
> Providers → Google)에 등록한다.

---

## 3. 로컬 개발

```bash
npm install
cp .env.example .env.local     # 위 표대로 채운다
# (최초 1회) 마이그레이션 적용 — 4절 참조
npm run dev                    # http://localhost:3000
```

개발 스크립트:

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | 단위 테스트(node:test + tsx, `--conditions=react-server`) |

---

## 4. Supabase 설정

### 4.1 Google OAuth

1. Google Cloud Console에서 OAuth 클라이언트(웹) 생성. 승인된 리디렉션 URI에
   `https://<프로젝트ref>.supabase.co/auth/v1/callback` 추가.
2. Supabase 대시보드 → Authentication → Providers → **Google 활성화**, 클라이언트 ID/시크릿 입력.
3. Authentication → URL Configuration의 Site URL / Redirect URLs에 배포 도메인(및 `http://localhost:3000`)을 등록.

### 4.2 마이그레이션 적용

DB 스키마·RLS는 `supabase/migrations/`의 SQL(0001~0009)로 관리한다. Supabase CLI로 적용한다:

```bash
supabase db push --db-url "$SUPABASE_DB_URL"
```

> 직접 호스트(`db.<ref>.supabase.co`)가 IPv6 전용이라 네트워크에서 라우팅이 안 되면, 동일 비밀번호로
> **IPv4 pooler(세션 모드)** URL을 쓴다:
> `postgresql://postgres.<ref>:<pw>@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`

적용되는 것(요약): `profiles`·`app_settings`(0001), `providers`·`api_keys`·`audit_logs`(0002),
`projects`·`students`·`rubrics`(0003), `submissions` + Storage `originals` 버킷·정책(0004), `match_method`(0005),
`evaluations`·`student_scores`(0006), `records`·`prompt_profiles`(0007), `prompt_profile_versions`(0008),
`ui_layouts`(0009). 모든 테이블 RLS 활성화.

### 4.3 시드(자동 — 별도 SQL 실행 불필요)

새 환경에서 시드는 **세 경로가 자동**으로 처리한다(중복 시드 스크립트 없음):

1. **최초 관리자 승격** — `ADMIN_EMAIL` 계정의 첫 Google 로그인 시 OAuth 콜백
   ([app/auth/callback/route.ts](app/auth/callback/route.ts))이 service role로 `role='admin'`·`status='approved'`로
   **멱등 승격**한다. (SQL 시드는 `auth.users` 생성 전 실행 불가 — DECISIONS 2026-07-07.)
2. **기본 프로바이더** — 마이그레이션 `0002`가 `google`/`anthropic`/`openai`를 시드한다(`is_seed=true`, 삭제 금지).
3. **시드 프롬프트 프로필** — 교사가 프로필 화면에 처음 접근할 때 `ensureDefaultProfile`
   ([app/projects/[id]/records/actions.ts](app/projects/[id]/records/actions.ts))이 계정 기본 프로필(문체 기본값)을
   생성한다. 내용은 [`docs/SEED_PROFILE.md`](docs/SEED_PROFILE.md) = `lib/prompts/seed-profile.ts`.

---

## 5. Vercel 배포

1. Vercel에 저장소 연결(Framework Preset: **Next.js**). 빌드 커맨드는 기본 `next build`, 설치는 `npm install`.
2. **환경변수**: 2절 표의 7개를 Vercel 프로젝트 Settings → Environment Variables에 등록
   (`NEXT_PUBLIC_*`는 공개, 나머지는 서버 전용). `SUPABASE_DB_URL`은 런타임에 필요 없으나 등록해 두어도 무방하다.
3. **원본 자동 삭제 Cron**: 저장소 루트의 [`vercel.json`](vercel.json)이 `/api/cron/purge-originals`를 매일
   03:00(UTC)에 호출하도록 배선한다. Vercel은 `CRON_SECRET`이 설정돼 있으면 이 값을 `Authorization: Bearer`로
   자동 첨부하고, 라우트가 이를 검증한다(불일치 401, 미설정 503). 이 Cron은 **추출 승인된**(INV-5) 원본만,
   프로젝트별 `file_retention_days`(7/30) 경과분만 삭제한다.
4. 배포 후 4.1의 Redirect URLs에 실제 배포 도메인을 반드시 추가한다.

> 참고: 로컬 빌드에서 "multiple lockfiles" 경고가 나올 수 있으나 이는 개발 머신 상위 폴더의 lockfile 때문이며
> Vercel 격리 빌드에는 영향이 없다.

---

## 6. 운영 가이드

- **가입 승인**: 새 교사가 Google 로그인하면 `pending` 상태로 대기 화면만 보인다. 관리자는 `/admin`에서
  승인/거부/삭제하고, 대기 안내문(`waiting_message`)을 편집할 수 있다.
- **API 키 등록**: 관리자는 `/admin`에서 프로바이더별 **기본 키**를 등록한다(개인 키 없는 사용자에 적용).
  각 교사는 `/account`에서 **개인 키**를 등록한다(존재하면 기본 키보다 우선). 화면에는 끝 4자리만 마스킹 표시되고,
  평문은 저장·로그·감사에 남지 않는다(INV-4).
- **모델 라우팅**: 프로젝트 설정에서 용도별(추출/평가/생성/검증) 프로바이더·모델을 조정한다. 기본값은
  추출=claude-haiku-4-5, 평가/생성/검증=claude-sonnet-4-6. 비-anthropic 개인 키 교사는 라우팅을 자기 프로바이더로 바꾼다.
- **원본 파일**: 교사가 추출 텍스트를 확인(승인)한 뒤에만 원본을 삭제할 수 있다(INV-5). 프로젝트 설정의
  "N일 후 자동 삭제"(7/30, 기본 끄기)는 Cron이 승인분만 처리한다.
- **감사 로그**: 승인/키 등록/원본 삭제/점수 보정/생성 등은 `audit_logs`에 기록된다(service role, 평문 키 금지).

### 보안 메모

- LLM API 키는 AES-256-GCM으로 암호화되어 `api_keys`에만 저장된다. 복호화·LLM 호출·service role 접근은
  모두 `server-only` 모듈로 강제되어 클라이언트 번들에 유입되지 않는다(빌드 시 실패로 강제).
- 키를 노출·공유했다면 즉시 폐기(회전)하고 `/admin`·`/account`에서 재등록한다.

---

## 7. 문서 맵

| 문서 | 내용 |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | 기능 명세 SSOT(읽기 전용) |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | 테이블·컬럼·제약·RLS 설계 |
| [`docs/INVARIANTS_AUDIT.md`](docs/INVARIANTS_AUDIT.md) | INV-1~6 코드 보장 지점 + RLS 전수 점검 결과 |
| [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) | 통합 스모크 시나리오(자동/브라우저/실 LLM) |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | 설계 판단 이력(약식 ADR) |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | 세션별 진행 상황 |
| [`docs/SEED_PROFILE.md`](docs/SEED_PROFILE.md) | 시드 프롬프트 프로필(문체 기본값) |
