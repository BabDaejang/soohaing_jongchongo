"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfileItems } from "@/app/projects/[id]/records/actions";
import type { ProfileItem } from "@/lib/supabase/types";

type Layer = "account" | "project";
type LayerItems = { guidelines: ProfileItem[]; prohibitions: ProfileItem[] };

function newItem(): ProfileItem {
  return { id: crypto.randomUUID(), text: "" };
}

// 프롬프트 프로필 편집 (SPEC 7.5). 좌(참고)/우(금지) 2패널 + 분할바 드래그, 계정/프로젝트 계층.
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
  const [accItems, setAccItems] = useState<LayerItems>(account);
  const [projItems, setProjItems] = useState<LayerItems>(project);
  const [leftPct, setLeftPct] = useState(50);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const items = layer === "account" ? accItems : projItems;
  const setItems = layer === "account" ? setAccItems : setProjItems;

  function update(
    field: "guidelines" | "prohibitions",
    next: ProfileItem[],
  ) {
    setSaved(false);
    setItems({ ...items, [field]: next });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveProfileItems(
          projectId,
          layer,
          items.guidelines,
          items.prohibitions,
        );
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장 실패");
      }
    });
  }

  // 분할바 드래그 — 컨테이너 폭 대비 좌 패널 비율(15~85%).
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
              {l === "account" ? "계정 기본" : "프로젝트 오버라이드"}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-400">
          적용 순서: 계정 기본 → 프로젝트 오버라이드(우선)
        </span>
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
          {pending ? "저장 중…" : `${layer === "account" ? "계정 기본" : "프로젝트"} 프로필 저장`}
        </button>
        {saved && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">
            저장됨
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
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
