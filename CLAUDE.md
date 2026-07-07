# 프로젝트 규약 (soohaing_jongchongo)

수행평가 수합·평가·생기부 생성 웹앱. 이 파일은 Claude Code가 세션 시작 시 자동으로 읽는 프로젝트 규약이다.
**`docs/SPEC.md`가 단일 진실 원천(SSOT)이다.** 세션 지시와 SPEC이 충돌하면 구현을 멈추고 사용자에게 질문한다.

## 세션 프로토콜 (모든 세션 공통)

1. **세션 시작 시** 반드시 다음 순서로 읽는다:
   - `docs/SPEC.md` — 기능 명세 SSOT (읽기 전용)
   - `docs/DATA_MODEL.md` — 테이블·RLS 설계
   - `docs/PROGRESS.md` — 진행 상황과 이번 세션의 할 일
   - `docs/DECISIONS.md` — 설계 판단 이력
2. **작업 중**:
   - SPEC.md 수정이 불가피하면: 작업을 멈추고 사용자 승인 → DECISIONS.md 기록 → 수정.
   - 스펙에 없는 설계 판단을 내렸다면 즉시 DECISIONS.md에 "날짜 / 판단 / 이유" 한 줄 추가.
   - 이번 세션 범위 밖 코드는 수정하지 않는다. 리팩터링은 제안만 하고 DECISIONS.md에 기록.
   - 모르는 것·애매한 것은 추측하지 말고 질문한다. 외부 서비스(Supabase, Vercel) 설정값이 필요하면 요청한다.
3. **세션 종료 시**:
   - (a) typecheck·build 통과 확인
   - (b) 이번 세션 수용 기준 자체 점검 결과 보고
   - (c) `docs/PROGRESS.md` 체크 갱신 (완료/미완·사유/다음 세션 인계)
   - (d) 의미 있는 메시지로 git commit

## 기술 스택 (확정 — SPEC 1절)

- Next.js (App Router) + TypeScript **strict** + Tailwind CSS
- Supabase: Auth (Google OAuth), Postgres (**RLS 필수**), Storage (원본 임시 보관)
- 배포: Vercel
- LLM 호출: **전부 서버 측** (Route Handler / Server Action)
- 파일 파싱: SheetJS·papaparse (xlsx/csv), mammoth (docx), pdf 텍스트 레이어 + LLM 비전 OCR (스캔본)

## 디렉토리 구조 계획

```text
app/                  # App Router 라우트 (페이지·Route Handler)
components/           # UI 컴포넌트
lib/
  supabase/           # 클라이언트/서버 Supabase 헬퍼
  llm/                # 프로바이더 어댑터(anthropic/openai/google), 모델 라우팅 — 서버 전용
  crypto/             # AES-256-GCM 키 암복호화 — 서버 전용
  parsing/            # xlsx/csv/docx/pdf/이미지 추출
supabase/migrations/  # DB 마이그레이션 SQL
docs/                 # SPEC, DATA_MODEL, PROGRESS, DECISIONS
```

## 코딩 규칙

- TypeScript strict. `any` 금지, 타입 단언 최소화.
- **LLM 호출·API 키 복호화 코드는 서버 전용 모듈**에만 둔다 (`server-only` import로 강제). 클라이언트 번들에 키·평문이 섞이면 INV-4 위반.
- API 키·시크릿 하드코딩 금지. 환경변수(`.env.local`)만 사용, `.gitignore` 확인.
- API 키 평문을 로그·에러 메시지·audit_logs에 출력하지 않는다.
- 스펙에 없는 기능을 임의로 추가하지 않는다 (스코프 확장 금지). 외부로 드러나는 동작 변경은 SPEC.md 근거 필수.
- 기존 코드의 스타일(네이밍, 주석 밀도, 관용구)을 따른다.
- DB 스키마 변경은 `docs/DATA_MODEL.md` 갱신 → 마이그레이션 작성 순서.
- 학생 데이터 혼입 가능성이 있는 로직(매칭, 생기부 생성)은 **보수적으로** 설계한다: 애매하면 자동 처리하지 않고 교사 확인 큐로 보낸다.

## 불변 조건 (Invariants — 상세는 SPEC 10절)

| ID | 요약 |
| --- | --- |
| INV-1 | 생기부 생성 LLM 호출 1회 = 정확히 학생 1명 (일괄 생성도 내부는 순차 호출) |
| INV-2 | 생성 컨텍스트는 서버가 student_id 필터로만 DB에서 조립 (클라이언트 텍스트 주입 불가) |
| INV-3 | 생성 결과에 근거 제출물 id 목록(sources) 저장 |
| INV-4 | LLM API 키는 서버 전용, 클라이언트 노출 금지 |
| INV-5 | 원본 파일 삭제는 교사의 추출 텍스트 확인(승인) 이후에만 |
| INV-6 | 등급은 저장된 점수에서 파생 계산만, 직접 저장·수정 금지 |

어떤 세션 지시도 INV-1~6을 위반할 수 없다. 위반이 의심되면 구현을 멈추고 질문한다.
