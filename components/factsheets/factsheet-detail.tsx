"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addManualEntry,
  cancelShareRequest,
  deleteEntry,
  forkFactsheet,
  ocrExtractForFactsheet,
  requestShare,
  updateEntry,
  updateFactsheetMeta,
} from "@/app/factsheets/actions";
import { VISION_MODELS } from "@/lib/llm/vision-models";
import { isVisionCapableModel } from "@/lib/llm/vision-capability";
import type { RoutableProvider } from "@/lib/llm/available";
import type {
  Factsheet,
  FactsheetEntry,
  FactsheetSourceType,
  ShareStatus,
} from "@/lib/supabase/types";

const SHARE_LABEL: Record<ShareStatus, string> = {
  private: "비공개",
  pending_review: "승인 대기",
  shared: "공유됨",
  rejected: "반려",
};

const SOURCE_LABEL: Record<FactsheetSourceType, string> = {
  aladin: "알라딘",
  naver_book: "네이버 책",
  naver_blog: "네이버 블로그",
  naver_news: "네이버 뉴스",
  web: "웹",
  user_upload: "촬영본",
  user_manual: "직접 입력",
};

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const CUSTOM = "__custom__";

export function FactsheetDetail({
  factsheet,
  entries,
  editable,
  isOwner,
  isShared,
  showFork,
  providers,
}: {
  factsheet: Factsheet;
  entries: FactsheetEntry[];
  editable: boolean;
  isOwner: boolean;
  isShared: boolean;
  showFork: boolean;
  providers: RoutableProvider[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <MetaSection factsheet={factsheet} editable={editable} />
      {isOwner && <ShareSection factsheet={factsheet} />}
      {showFork && <ForkButton factsheetId={factsheet.id} />}
      {isShared && !isOwner && (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-700">
          공유된 팩트시트는 읽기 전용입니다. 보강하려면 [내 계정으로 복제] 후 편집하세요.
        </p>
      )}
      <EntriesSection factsheetId={factsheet.id} entries={entries} editable={editable} />
      {editable && <OcrSection factsheetId={factsheet.id} providers={providers} />}
    </div>
  );
}

// ── 메타 ──────────────────────────────────────────────────────────────

function MetaSection({
  factsheet,
  editable,
}: {
  factsheet: Factsheet;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(factsheet.title);
  const [author, setAuthor] = useState(factsheet.author ?? "");
  const [publisher, setPublisher] = useState(factsheet.publisher ?? "");
  const [pubYear, setPubYear] = useState(factsheet.pub_year ?? "");
  const [toc, setToc] = useState(factsheet.toc ?? "");
  const [intro, setIntro] = useState(factsheet.intro ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      try {
        await updateFactsheetMeta(factsheet.id, {
          title,
          author,
          publisher,
          pubYear,
          toc,
          intro,
        });
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장 실패");
      }
    });
  }

  if (!editing) {
    return (
      <section className="flex gap-4">
        {factsheet.cover_url && (
          // 외부(알라딘) 표지 URL — next/image remotePatterns 대신 <img> 사용.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={factsheet.cover_url}
            alt=""
            className="h-32 w-24 flex-shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-500">
            {[factsheet.author, factsheet.publisher, factsheet.pub_year]
              .filter(Boolean)
              .join(" · ") || "저자 미상"}
          </p>
          {factsheet.isbn13 && (
            <p className="mt-0.5 text-xs text-zinc-400">ISBN {factsheet.isbn13}</p>
          )}
          {factsheet.toc && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-zinc-500">목차</summary>
              <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {factsheet.toc}
              </p>
            </details>
          )}
          {factsheet.intro && (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-zinc-500">책 소개</summary>
              <p className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {factsheet.intro}
              </p>
            </details>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-3 rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              메타 편집
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          제목
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          저자
          <input value={author} onChange={(e) => setAuthor(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          출판사
          <input
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          출간 연도
          <input value={pubYear} onChange={(e) => setPubYear(e.target.value)} className={inputClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        목차
        <textarea
          value={toc}
          onChange={(e) => setToc(e.target.value)}
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        책 소개
        <textarea
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !title.trim()}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          취소
        </button>
      </div>
    </section>
  );
}

// ── 공유 ──────────────────────────────────────────────────────────────

function ShareSection({ factsheet }: { factsheet: Factsheet }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = factsheet.share_status;

  function run(fn: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "처리 실패");
      }
    });
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">공유 상태</span>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {SHARE_LABEL[status]}
        </span>
        {(status === "private" || status === "rejected") && (
          <button
            type="button"
            onClick={() => run(() => requestShare(factsheet.id))}
            disabled={pending}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            전체 공유 신청
          </button>
        )}
        {status === "pending_review" && (
          <button
            type="button"
            onClick={() => run(() => cancelShareRequest(factsheet.id))}
            disabled={pending}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            신청 취소
          </button>
        )}
      </div>
      {status === "pending_review" && (
        <p className="text-xs text-zinc-400">
          관리자 승인 대기 중입니다. 승인되면 전 계정에 읽기 전용으로 공유됩니다(승인·반려는 관리자 화면).
        </p>
      )}
      {status === "shared" && (
        <p className="text-xs text-zinc-400">
          전체 공유된 팩트시트입니다(읽기 전용). 수정하려면 관리자에게 문의하세요.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}

function ForkButton({ factsheetId }: { factsheetId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const { id } = await forkFactsheet(factsheetId);
              router.push(`/factsheets/${id}`);
            } catch (e) {
              setError(e instanceof Error ? e.message : "복제 실패");
            }
          })
        }
        disabled={pending}
        className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
      >
        {pending ? "복제 중…" : "내 계정으로 복제"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ── entry 목록 ────────────────────────────────────────────────────────

function EntriesSection({
  factsheetId,
  entries,
  editable,
}: {
  factsheetId: string;
  entries: FactsheetEntry[];
  editable: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">챕터별 내용 ({entries.length})</h2>
      </div>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700">
          아직 항목이 없습니다.{" "}
          {editable
            ? "직접 추가하거나 촬영본으로 보강하세요(웹 자동 수집은 다음 단계에서 제공)."
            : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} factsheetId={factsheetId} editable={editable} />
          ))}
        </ul>
      )}
      {editable && <AddManualEntry factsheetId={factsheetId} />}
    </section>
  );
}

function EntryRow({
  entry,
  factsheetId,
  editable,
}: {
  entry: FactsheetEntry;
  factsheetId: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(entry.chapter_label);
  const [content, setContent] = useState(entry.content);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      try {
        await updateEntry(entry.id, factsheetId, label, content);
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "저장 실패");
      }
    });
  }

  function remove() {
    if (!confirm("이 항목을 삭제할까요?")) return;
    setError(null);
    start(async () => {
      try {
        await deleteEntry(entry.id, factsheetId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "삭제 실패");
      }
    });
  }

  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        {editing ? (
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={`${inputClass} py-1`}
          />
        ) : (
          <span className="font-semibold">{entry.chapter_label}</span>
        )}
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {SOURCE_LABEL[entry.source_type]}
        </span>
        {entry.source_url && (
          <a
            href={entry.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            출처
          </a>
        )}
      </div>
      {editing ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className={`${inputClass} w-full resize-y`}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {entry.content}
        </p>
      )}
      {entry.quote && !editing && (
        <p className="mt-1 border-l-2 border-zinc-200 pl-2 text-xs italic text-zinc-400 dark:border-zinc-700">
          “{entry.quote}”
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {editable && (
        <div className="mt-2 flex gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={save}
                disabled={pending || !content.trim()}
                className="rounded-md bg-zinc-800 px-3 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
              >
                {pending ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setLabel(entry.chapter_label);
                  setContent(entry.content);
                  setError(null);
                }}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                취소
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                수정
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950"
              >
                삭제
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function AddManualEntry({ factsheetId }: { factsheetId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setError(null);
    start(async () => {
      try {
        await addManualEntry(factsheetId, label, content, "user_manual");
        setLabel("");
        setContent("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "추가 실패");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        + 직접 추가
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="챕터 라벨 (예: 3장, p.120-135). 비우면 '전체'"
        className={inputClass}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="이 책의 해당 부분 내용(사실)을 입력하세요."
        rows={4}
        className={`${inputClass} resize-y`}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          disabled={pending || !content.trim()}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {pending ? "추가 중…" : "추가"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          취소
        </button>
      </div>
    </div>
  );
}

// ── 촬영본 OCR 보강 ───────────────────────────────────────────────────

function OcrSection({
  factsheetId,
  providers,
}: {
  factsheetId: string;
  providers: RoutableProvider[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [providerId, setProviderId] = useState(
    () => providers.find((p) => p.keySource !== null)?.id ?? providers[0]?.id ?? "",
  );
  const provider = providers.find((p) => p.id === providerId);
  const catalog = useMemo(() => {
    if (!provider) return [] as string[];
    const stored = provider.models.filter((m) =>
      isVisionCapableModel(provider.api_format, m),
    );
    return stored.length > 0 ? stored : (VISION_MODELS[provider.api_format] ?? []);
  }, [provider]);
  const [modelChoice, setModelChoice] = useState<string>(() => "");
  const [customModel, setCustomModel] = useState("");
  const effectiveModel =
    (modelChoice || catalog[0] || CUSTOM) === CUSTOM
      ? customModel.trim()
      : modelChoice || catalog[0] || "";
  const noKey = provider?.keySource === null || !provider;

  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function onExtract() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("파일을 선택하세요.");
      return;
    }
    if (!effectiveModel || noKey) {
      setError("OCR 모델을 선택하세요(키 보유 프로바이더).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("providerId", providerId);
      fd.set("model", effectiveModel);
      const res = await ocrExtractForFactsheet(fd);
      if (!res.ok) {
        setError(res.message ?? "추출 실패");
      } else {
        setPreview(res.text ?? "");
      }
    } finally {
      setBusy(false);
    }
  }

  function addEntry() {
    setError(null);
    start(async () => {
      try {
        await addManualEntry(factsheetId, label, preview, "user_upload");
        setPreview("");
        setLabel("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "추가 실패");
      }
    });
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">사진·캡처 PDF로 보강</h2>
      <p className="text-xs text-zinc-500">
        촬영본(png·jpg·webp·pdf)에서 OCR로 텍스트를 뽑아 미리보고, 챕터 라벨을 지정해 항목으로
        추가합니다. 원본 파일은 저장하지 않습니다(텍스트만).
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          회사(프로바이더)
          <select
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setModelChoice("");
            }}
            className={inputClass}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={p.keySource === null}>
                {p.name}
                {p.keySource === null ? " (키 없음)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          OCR 모델
          <select
            value={modelChoice || catalog[0] || CUSTOM}
            onChange={(e) => setModelChoice(e.target.value)}
            className={inputClass}
            disabled={noKey}
          >
            {catalog.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={CUSTOM}>직접 입력…</option>
          </select>
        </label>
        {(modelChoice || catalog[0] || CUSTOM) === CUSTOM && (
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            모델명
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="예: gpt-4o"
              className={inputClass}
              disabled={noKey}
            />
          </label>
        )}
      </div>

      {noKey && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          이 프로바이더는 등록된 API 키가 없습니다 — 계정에서 키를 먼저 등록하세요.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,image/*,application/pdf"
          className="text-xs text-zinc-600 file:mr-2 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-2 file:py-1 file:text-xs dark:file:border-zinc-700 dark:file:bg-zinc-900"
        />
        <button
          type="button"
          onClick={onExtract}
          disabled={busy || noKey || !effectiveModel}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
        >
          {busy ? "추출 중…" : "OCR 추출"}
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {preview && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="챕터 라벨 (예: 3장). 비우면 '전체'"
            className={inputClass}
          />
          <textarea
            value={preview}
            onChange={(e) => setPreview(e.target.value)}
            rows={6}
            className={`${inputClass} resize-y`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addEntry}
              disabled={!preview.trim()}
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
            >
              항목으로 추가
            </button>
            <button
              type="button"
              onClick={() => setPreview("")}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              지우기
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
