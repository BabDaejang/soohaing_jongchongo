"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveProfileItems,
  importProfileFromMarkdown,
  listProfileVersions,
  restoreProfileVersion,
  type ProfileVersionRow,
} from "@/app/projects/[id]/records/actions";
import {
  renderProfileMarkdown,
  parseProfileMarkdown,
} from "@/lib/records/profile-markdown";
import type { ProfileItem, ProfileVersionSource } from "@/lib/supabase/types";

type Layer = "account" | "project";
type LayerItems = {
  guidelines: ProfileItem[];
  prohibitions: ProfileItem[];
  version: number;
  updatedAt: string | null;
};

const LAYER_TITLE: Record<Layer, string> = {
  account: "계정 기본",
  project: "프로젝트 오버라이드",
};

const SOURCE_LABEL: Record<ProfileVersionSource, string> = {
  seed: "시드",
  edit: "편집",
  ingest: "예시반영",
  import: "가져오기",
  restore: "복원",
};

function newItem(): ProfileItem {
  return { id: crypto.randomUUID(), text: "" };
}

function fmt(dt: string | null): string {
  return dt ? new Date(dt).toLocaleString("ko-KR") : "미저장";
}

// 프롬프트 프로필 편집 (SPEC 7.5 + 세션 8a 확장).
// 좌(참고)/우(금지) 2패널 + 분할바 드래그, 계정/프로젝트 계층, 버전·날짜 표시, MD 내보내기/가져오기, 버전 이력·복원.
export function ProfileEditor({
  projectId,
  account,
  project,
}: {
  projectId: string;
  account: LayerItems;
  project: LayerItems;
}) {
  const router = useRouter();
  const [layer, setLayer] = useState<Layer>("account");
  const [accItems, setAccItems] = useState(pick(account));
  const [projItems, setProjItems] = useState(pick(project));
  const [leftPct, setLeftPct] = useState(50);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 서버 내용이 바뀌면(저장·가져오기·복원 후 새 버전) 편집 패널을 재동기화한다.
  // React 권장 패턴: 렌더 중 시그니처 비교로 리셋(단순 타이핑=부모 미갱신 시엔 실행 안 됨).
  const sig = `${account.version}|${account.updatedAt}|${project.version}|${project.updatedAt}`;
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    setPrevSig(sig);
    setAccItems(pick(account));
    setProjItems(pick(project));
  }

  const items = layer === "account" ? accItems : projItems;
  const setItems = layer === "account" ? setAccItems : setProjItems;
  const meta = layer === "account" ? account : project;

  function update(field: "guidelines" | "prohibitions", next: ProfileItem[]) {
    setSaved(false);
    setItems({ ...items, [field]: next });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveProfileItems(projectId, layer, items.guidelines, items.prohibitions);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장 실패");
      }
    });
  }

  function exportMd() {
    const md = renderProfileMarkdown(
      { title: LAYER_TITLE[layer], version: meta.version, updatedLabel: fmt(meta.updatedAt) },
      items.guidelines,
      items.prohibitions,
    );
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `프로필_${layer}_v${meta.version || 0}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(85, Math.max(15, pct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {(["account", "project"] as Layer[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLayer(l);
                setSaved(false);
              }}
              className={`px-3 py-1.5 text-sm ${
                layer === l
                  ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {LAYER_TITLE[l]}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-400">
          적용 순서: 계정 기본 → 프로젝트 오버라이드(우선)
        </span>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-zinc-500">
          {meta.version > 0 ? (
            <>
              버전 <b>v{meta.version}</b> · 업데이트 {fmt(meta.updatedAt)}
            </>
          ) : (
            "저장 전(버전 없음)"
          )}
        </span>
        <button
          type="button"
          onClick={exportMd}
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          MD 내보내기
        </button>
      </div>

      <div
        ref={containerRef}
        className="flex items-stretch rounded-lg border border-zinc-200 dark:border-zinc-800"
      >
        <div style={{ width: `${leftPct}%` }} className="min-w-0 p-3">
          <ItemPanel
            title="작성 참고사항"
            items={items.guidelines}
            onChange={(next) => update("guidelines", next)}
          />
        </div>
        <div
          onMouseDown={startDrag}
          className="w-1.5 shrink-0 cursor-col-resize bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          title="드래그하여 폭 조절"
        />
        <div style={{ width: `${100 - leftPct}%` }} className="min-w-0 p-3">
          <ItemPanel
            title="금지사항"
            items={items.prohibitions}
            onChange={(next) => update("prohibitions", next)}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "저장 중…" : `${LAYER_TITLE[layer]} 프로필 저장`}
        </button>
        {saved && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">
            저장됨
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      <MarkdownImport projectId={projectId} layer={layer} onDone={() => router.refresh()} />
      <VersionHistoryPanel projectId={projectId} layer={layer} onRestored={() => router.refresh()} />
    </div>
  );
}

function pick(l: LayerItems): { guidelines: ProfileItem[]; prohibitions: ProfileItem[] } {
  return { guidelines: l.guidelines, prohibitions: l.prohibitions };
}

// ── MD 가져오기: 붙여넣기/파일 → 미리보기 → 확인 반영 ─────────────────────
function MarkdownImport({
  projectId,
  layer,
  onDone,
}: {
  projectId: string;
  layer: Layer;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{
    guidelines: ProfileItem[];
    prohibitions: ProfileItem[];
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      setText(t);
      setPreview(null);
      setMsg(null);
    });
  }

  function doPreview() {
    setError(null);
    setMsg(null);
    const parsed = parseProfileMarkdown(text);
    if (parsed.guidelines.length === 0 && parsed.prohibitions.length === 0) {
      setError("가져올 항목을 찾지 못했습니다. '## 작성 참고사항'·'## 금지사항' 아래 목록 형식을 확인하세요.");
      setPreview(null);
      return;
    }
    setPreview(parsed);
  }

  function confirmImport() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await importProfileFromMarkdown(projectId, layer, text);
        setMsg(`가져오기 완료 — 참고 ${r.guidelines} · 금지 ${r.prohibitions} (v${r.version})`);
        setPreview(null);
        setText("");
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "가져오기 실패");
      }
    });
  }

  return (
    <details className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <summary className="cursor-pointer text-sm font-semibold">
        MD 가져오기 ({LAYER_TITLE[layer]})
      </summary>
      <p className="mt-2 text-xs text-zinc-500">
        내보낸 .md를 편집한 뒤 붙여넣거나 파일을 선택하고, 미리보기로 확인한 후 반영하세요.
        반영 시 현재 항목은 이 내용으로 교체되고 새 버전이 됩니다.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={onFile} className="text-xs" />
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        rows={6}
        placeholder="여기에 MD를 붙여넣으세요."
        className="mt-2 w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={doPreview}
          disabled={!text.trim()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          미리보기
        </button>
        {preview && (
          <button
            type="button"
            onClick={confirmImport}
            disabled={pending}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-white disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
          >
            {pending ? "반영 중…" : "가져오기 반영"}
          </button>
        )}
        {msg && <span className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {preview && (
        <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
          <PreviewList title={`참고 ${preview.guidelines.length}`} items={preview.guidelines} />
          <PreviewList title={`금지 ${preview.prohibitions.length}`} items={preview.prohibitions} />
        </div>
      )}
    </details>
  );
}

function PreviewList({ title, items }: { title: string; items: ProfileItem[] }) {
  return (
    <div className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="mb-1 font-semibold text-zinc-500">{title}</div>
      <ol className="list-decimal pl-4 text-zinc-700 dark:text-zinc-300">
        {items.map((it) => (
          <li key={it.id}>{it.text}</li>
        ))}
      </ol>
    </div>
  );
}

// ── 버전 이력: 지연 로드 + 열람 + 복원 ─────────────────────────────────────
function VersionHistoryPanel({
  projectId,
  layer,
  onRestored,
}: {
  projectId: string;
  layer: Layer;
  onRestored: () => void;
}) {
  const [rows, setRows] = useState<ProfileVersionRow[] | null>(null);
  const [loadedLayer, setLoadedLayer] = useState<Layer | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    startTransition(async () => {
      const v = await listProfileVersions(projectId, layer);
      setRows(v);
      setLoadedLayer(layer);
    });
  }

  function restore(version: number) {
    setError(null);
    startTransition(async () => {
      try {
        await restoreProfileVersion(projectId, layer, version);
        onRestored();
      } catch (e) {
        setError(e instanceof Error ? e.message : "복원 실패");
      }
    });
  }

  // 레이어가 바뀌면 다시 로드하도록 유도.
  const stale = loadedLayer !== null && loadedLayer !== layer;

  return (
    <details
      className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && (rows === null || stale)) load();
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold">
        버전 이력 ({LAYER_TITLE[layer]})
      </summary>
      {pending && <p className="mt-2 text-xs text-zinc-400">불러오는 중…</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {rows && !stale && rows.length === 0 && (
        <p className="mt-2 text-xs text-zinc-400">이력이 없습니다.</p>
      )}
      {stale && (
        <button
          type="button"
          onClick={load}
          className="mt-2 text-xs text-zinc-500 underline"
        >
          이 계층 이력 불러오기
        </button>
      )}
      {rows && !stale && rows.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {rows.map((v) => (
            <li key={v.version} className="rounded border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === v.version ? null : v.version)}
                  className="text-left hover:underline"
                >
                  v{v.version} · {SOURCE_LABEL[v.source]} ·{" "}
                  {new Date(v.created_at).toLocaleString("ko-KR")}
                </button>
                <button
                  type="button"
                  onClick={() => restore(v.version)}
                  disabled={pending}
                  className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  이 버전으로 복원
                </button>
              </div>
              {expanded === v.version && (
                <div className="grid gap-2 border-t border-zinc-200 p-2 text-xs dark:border-zinc-800 sm:grid-cols-2">
                  <PreviewList title={`참고 ${v.guidelines.length}`} items={v.guidelines} />
                  <PreviewList title={`금지 ${v.prohibitions.length}`} items={v.prohibitions} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function ItemPanel({
  title,
  items,
  onChange,
}: {
  title: string;
  items: ProfileItem[];
  onChange: (next: ProfileItem[]) => void;
}) {
  function setText(idx: number, text: string) {
    onChange(items.map((it, i) => (i === idx ? { ...it, text } : it)));
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }
  function add() {
    onChange([...items, newItem()]);
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((it, idx) => (
          <li key={it.id} className="flex items-start gap-1">
            <textarea
              value={it.text}
              onChange={(e) => setText(idx, e.target.value)}
              rows={2}
              className="w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <span className="flex shrink-0 flex-col">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                className="px-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                title="위로"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                className="px-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                title="아래로"
              >
                ▼
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="px-1 text-xs text-red-400 hover:text-red-600"
                title="삭제"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        className="mt-2 rounded border border-dashed border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        + 항목 추가
      </button>
    </div>
  );
}
