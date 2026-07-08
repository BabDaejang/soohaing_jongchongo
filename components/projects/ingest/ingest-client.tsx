"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fileKind } from "@/lib/parsing/kind";
import type { ColumnMapping } from "@/lib/parsing/types";
import {
  ingestDocuments,
  ingestSpreadsheet,
  previewSpreadsheet,
  type IngestSummary,
  type SpreadsheetPreview,
} from "@/app/projects/[id]/ingest/actions";
import { ColumnMapper } from "@/components/projects/ingest/column-mapper";

type Summary = { inserted: number; skipped: number; updatePending: number };
type SheetJob = {
  storagePath: string;
  filename: string;
  preview: SpreadsheetPreview;
};

const ZERO: Summary = { inserted: 0, skipped: 0, updatePending: 0 };

function sanitize(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

export function IngestClient({
  projectId,
  ownerId,
}: {
  projectId: string;
  ownerId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState<Summary>(ZERO);
  const [errors, setErrors] = useState<string[]>([]);
  const [queue, setQueue] = useState<SheetJob[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const mergeSummary = (s: IngestSummary) => {
    setSummary((prev) => ({
      inserted: prev.inserted + s.inserted,
      skipped: prev.skipped + s.skipped,
      updatePending: prev.updatePending + s.updatePending,
    }));
    if (s.errors.length) {
      setErrors((prev) => [
        ...prev,
        ...s.errors.map((e) => `${e.filename}: ${e.message}`),
      ]);
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setErrors([]);
    setSummary(ZERO);
    const files = Array.from(fileList);

    // 1) Storage에 업로드 (RLS owner 경로)
    const uploaded: { storagePath: string; filename: string }[] = [];
    for (const file of files) {
      setStatus(`업로드 중: ${file.name}`);
      const path = `${ownerId}/${projectId}/${crypto.randomUUID()}__${sanitize(file.name)}`;
      const { error } = await supabase.storage
        .from("originals")
        .upload(path, file, { upsert: false });
      if (error) {
        setErrors((p) => [...p, `${file.name}: 업로드 실패 (${error.message})`]);
        continue;
      }
      uploaded.push({ storagePath: path, filename: file.name });
    }

    const docs = uploaded.filter((u) => {
      const k = fileKind(u.filename);
      return k === "docx" || k === "pdf" || k === "image";
    });
    const sheets = uploaded.filter((u) => fileKind(u.filename) === "spreadsheet");
    const unknown = uploaded.filter((u) => fileKind(u.filename) === "unknown");
    for (const u of unknown) {
      setErrors((p) => [...p, `${u.filename}: 지원하지 않는 형식`]);
    }

    // 2) 문서·PDF·이미지는 즉시 파싱/OCR (스캔·이미지는 시간이 걸릴 수 있음)
    if (docs.length) {
      setStatus(`텍스트 추출 중 (${docs.length}개)…`);
      try {
        const s = await ingestDocuments(projectId, docs);
        mergeSummary(s);
      } catch (e) {
        setErrors((p) => [...p, msg(e)]);
      }
    }

    // 3) 스프레드시트는 헤더 미리보기 → 열 매핑 큐
    if (sheets.length) {
      setStatus("스프레드시트 헤더 분석 중…");
      const jobs: SheetJob[] = [];
      for (const s of sheets) {
        try {
          const preview = await previewSpreadsheet(projectId, s.storagePath, s.filename);
          jobs.push({ ...s, preview });
        } catch (e) {
          setErrors((p) => [...p, `${s.filename}: ${msg(e)}`]);
        }
      }
      setQueue(jobs);
    }

    setStatus("");
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  };

  const confirmMapping = async (mapping: ColumnMapping) => {
    const job = queue[0];
    if (!job) return;
    setBusy(true);
    setStatus(`수합 중: ${job.filename}`);
    try {
      const s = await ingestSpreadsheet(projectId, job.storagePath, job.filename, mapping);
      mergeSummary(s);
    } catch (e) {
      setErrors((p) => [...p, `${job.filename}: ${msg(e)}`]);
    }
    setQueue((q) => q.slice(1));
    setStatus("");
    setBusy(false);
    router.refresh();
  };

  const skipMapping = () => setQueue((q) => q.slice(1));

  const current = queue[0];

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
          dragOver
            ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-900"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        <p className="text-sm text-zinc-500">
          파일을 여기로 끌어다 놓거나
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="mx-1 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-60 dark:hover:text-zinc-200"
          >
            선택
          </button>
          하세요.
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          xlsx · csv · docx · pdf · png/jpg (여러 개 가능)
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg,.webp,.gif"
          onChange={(e) => void handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {busy && (
        <p className="text-sm text-zinc-500">
          <span className="animate-pulse">● </span>
          {status || "처리 중…"}
        </p>
      )}

      {(summary.inserted > 0 ||
        summary.skipped > 0 ||
        summary.updatePending > 0) && (
        <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          신규 <b>{summary.inserted}</b> · 중복 스킵 <b>{summary.skipped}</b> ·
          변경 대기 <b>{summary.updatePending}</b>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-200 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {current && (
        <ColumnMapper
          key={current.storagePath}
          filename={current.filename}
          headers={current.preview.headers}
          sampleRows={current.preview.sampleRows}
          initial={current.preview.suggested}
          busy={busy}
          onConfirm={confirmMapping}
          onCancel={skipMapping}
        />
      )}
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "알 수 없는 오류";
}
