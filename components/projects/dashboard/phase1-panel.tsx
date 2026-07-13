"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fileKind } from "@/lib/parsing/kind";
import type { ColumnMapping } from "@/lib/parsing";
import {
  listUploadedFiles,
  deleteUploadedFile,
  prepareIngest,
  ingestOneFile,
  finalizeIngest,
  previewSpreadsheet,
  type UploadedFile,
  type SpreadsheetPreview,
} from "@/app/projects/[id]/ingest/actions";
import {
  prepareMatching,
  matchOneByLlm,
  finalizeMatching,
} from "@/app/projects/[id]/submissions/actions";
import {
  useSequentialRun,
  type RunPlan,
  type SequentialTarget,
} from "@/lib/hooks/use-sequential-run";
import { RunTerminal } from "@/components/projects/run-terminal";
import { OcrModelSelect } from "@/components/projects/ingest/ocr-model-select";
import { ColumnMapper } from "@/components/projects/ingest/column-mapper";
import { emitWorksheetRefresh } from "@/lib/worksheet/refresh";
import type { RoutableProvider } from "@/lib/llm/available";
import type { ModelTarget } from "@/lib/llm";

function sanitize(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_");
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "알 수 없는 오류";
}

// 파일별 기본 체크: 미수합 = checked, 수합됨 = unchecked (사용자 지시).
function defaultChecked(files: UploadedFile[]): Set<string> {
  return new Set(files.filter((f) => !f.ingested).map((f) => f.path));
}

type SheetJob = { path: string; filename: string; preview: SpreadsheetPreview };

// 페이즈 1 · 수합 (리팩토링 2 배치 6). 업로드는 Storage에만(파싱 분리), [수합 & 매칭]으로
// 수합 → 매칭이 한 터미널에서 자동 연쇄한다. 1건 끝날 때마다 작업결과표가 갱신된다.
export function Phase1Panel({
  projectId,
  ownerId,
  providers,
  extract,
  initialFiles,
  pendingCount,
}: {
  projectId: string;
  ownerId: string;
  providers: RoutableProvider[];
  extract: ModelTarget;
  initialFiles: UploadedFile[];
  pendingCount: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<UploadedFile[]>(initialFiles);
  const [checked, setChecked] = useState<Set<string>>(() =>
    defaultChecked(initialFiles),
  );
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [preparing, setPreparing] = useState(false);

  // 시트 열 매핑 확정 흐름(순차 모달). resolve로 실행 흐름에 매핑을 돌려준다.
  const [sheetJob, setSheetJob] = useState<{
    job: SheetJob;
    resolve: (m: ColumnMapping | null) => void;
  } | null>(null);

  // start() 직전에 세팅해 prepare/stepOne이 읽는다(훅 재생성 없이 값 전달).
  const targetPathsRef = useRef<string[]>([]);
  const mappingsRef = useRef<Record<string, ColumnMapping>>({});

  const refreshFiles = useCallback(async () => {
    try {
      const next = await listUploadedFiles(projectId);
      setFiles(next);
      setChecked(defaultChecked(next));
    } catch (e) {
      setErrors((p) => [...p, msg(e)]);
    }
  }, [projectId]);

  // ── 실행 계획(수합 → 매칭 연쇄) ──────────────────────────────────
  const prepare = useCallback(
    () => prepareIngest(projectId, targetPathsRef.current),
    [projectId],
  );
  const stepOne = useCallback(
    async (t: SequentialTarget) => {
      const r = await ingestOneFile(projectId, t.id, mappingsRef.current[t.id]);
      emitWorksheetRefresh(); // 1건마다 작업결과표 갱신
      return r;
    },
    [projectId],
  );
  const finalize = useCallback(
    (r: { succeeded: number; failed: number }) =>
      finalizeIngest(projectId, { succeeded: r.succeeded, failed: r.failed }),
    [projectId],
  );
  // 수합이 정상 종료하면 매칭 스테이지를 이어 실행한다.
  const nextStage = useCallback(
    (): RunPlan => ({
      prepare: async () => {
        const { prelude, llmTargets } = await prepareMatching(projectId);
        return { targets: llmTargets, prelude };
      },
      stepOne: async (t: SequentialTarget) => {
        const r = await matchOneByLlm(projectId, t.id);
        emitWorksheetRefresh();
        return r;
      },
      finalize: async () => {
        await finalizeMatching(projectId);
        return "매칭 반영 완료 — 동명이인·식별 불가는 확인 대기 큐에서 지정하세요.";
      },
    }),
    [projectId],
  );

  const { lines, runState, progress, start, pause, resume, stop } =
    useSequentialRun({ prepare, stepOne, finalize, nextStage });

  const running =
    runState === "running" || runState === "paused" || runState === "stopping";

  // 실행 종료 시 파일 목록·서버 데이터 갱신.
  useEffect(() => {
    if (runState === "done" || runState === "aborted") {
      void refreshFiles();
      router.refresh();
    }
  }, [runState, refreshFiles, router]);

  // ── 업로드(Storage에만 — 파싱 없음) ─────────────────────────────
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploadBusy(true);
    setErrors([]);
    for (const file of Array.from(fileList)) {
      if (fileKind(file.name) === "unknown") {
        setErrors((p) => [...p, `${file.name}: 지원하지 않는 형식`]);
        continue;
      }
      setUploadStatus(`업로드 중: ${file.name}`);
      const path = `${ownerId}/${projectId}/${crypto.randomUUID()}__${sanitize(file.name)}`;
      const { error } = await supabase.storage
        .from("originals")
        .upload(path, file, { upsert: false });
      if (error) {
        setErrors((p) => [...p, `${file.name}: 업로드 실패 (${error.message})`]);
      }
    }
    setUploadStatus("");
    setUploadBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    await refreshFiles();
  };

  const toggle = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const remove = async (path: string) => {
    setErrors([]);
    try {
      await deleteUploadedFile(projectId, path);
      await refreshFiles();
    } catch (e) {
      setErrors((p) => [...p, msg(e)]);
    }
  };

  const askMapping = (path: string, filename: string): Promise<ColumnMapping | null> =>
    previewSpreadsheet(projectId, path, filename).then(
      (preview) =>
        new Promise<ColumnMapping | null>((resolve) => {
          setSheetJob({ job: { path, filename, preview }, resolve });
        }),
    );

  // ── [수합 & 매칭] ───────────────────────────────────────────────
  const onRun = async () => {
    if (running || preparing) return;
    setErrors([]);
    setPreparing(true);
    try {
      const targets: string[] = [];
      const mappings: Record<string, ColumnMapping> = {};
      for (const f of files) {
        if (!checked.has(f.path)) continue;
        if (fileKind(f.filename) === "spreadsheet") {
          let mapping: ColumnMapping | null;
          try {
            mapping = await askMapping(f.path, f.filename);
          } catch (e) {
            setErrors((p) => [...p, `${f.filename}: ${msg(e)}`]);
            continue;
          }
          if (!mapping) continue; // 취소한 시트는 제외
          mappings[f.path] = mapping;
          targets.push(f.path);
        } else {
          targets.push(f.path);
        }
      }
      targetPathsRef.current = targets;
      mappingsRef.current = mappings;
      start(); // 대상 0개여도 실행(수합 스킵, 매칭만)
    } finally {
      setPreparing(false);
    }
  };

  const btn =
    "rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white";

  return (
    <div className="flex flex-col gap-4">
      {/* ① 실행 컨트롤 */}
      <div className="flex flex-col gap-3">
        <OcrModelSelect
          projectId={projectId}
          providers={providers}
          extract={extract}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={onRun} disabled={running || preparing} className={btn}>
            {running ? "수합·매칭 중…" : preparing ? "준비 중…" : "수합 & 매칭"}
          </button>
          {progress && running && (
            <span className="text-xs font-medium text-zinc-500">
              진행 {progress.done}/{progress.total}
            </span>
          )}
          <span className="text-xs text-zinc-400">
            체크한 파일을 수합한 뒤 자동으로 학생 매칭을 이어서 실행합니다. 진행 중 일시정지·재개·긴급
            중단할 수 있고, 중단해도 처리분은 반영됩니다.
          </span>
        </div>
      </div>

      {/* ② 실행 터미널 (상시) */}
      <RunTerminal
        lines={lines}
        runState={runState}
        progress={progress}
        onPause={pause}
        onResume={resume}
        onStop={stop}
      />

      {/* ③ 업로드 박스 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!uploadBusy) void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed px-6 py-8 text-center transition ${
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
            disabled={uploadBusy}
            className="mx-1 underline underline-offset-2 hover:text-zinc-800 disabled:opacity-60 dark:hover:text-zinc-200"
          >
            선택
          </button>
          하세요. 업로드만 하고, 토큰은 [수합 & 매칭] 실행 때 소모됩니다.
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

      {uploadBusy && (
        <p className="text-sm text-zinc-500">
          <span className="animate-pulse">● </span>
          {uploadStatus || "처리 중…"}
        </p>
      )}

      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-200 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {/* ④ 업로드 파일 목록 */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">업로드된 파일 ({files.length})</h3>
        {files.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-6 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
            아직 업로드된 파일이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {files.map((f) => (
              <li
                key={f.path}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <input
                  type="checkbox"
                  checked={checked.has(f.path)}
                  onChange={() => toggle(f.path)}
                  className="h-4 w-4"
                />
                <span className="flex-1 truncate" title={f.filename}>
                  {f.filename}
                </span>
                {f.createdAt && (
                  <span className="text-xs text-zinc-400">
                    {new Date(f.createdAt).toLocaleString("ko-KR")}
                  </span>
                )}
                {f.ingested && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                    수합됨
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void remove(f.path)}
                  disabled={f.ingested || running}
                  title={f.ingested ? "수합된 파일은 제출물 상세의 추출 확인 절차로 삭제합니다." : undefined}
                  className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ⑤ 확인 대기 배지 + 매칭·확인 링크 */}
      <div className="flex items-center gap-3 text-sm">
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            확인 대기 {pendingCount}건
          </span>
        )}
        <Link
          href={`/projects/${projectId}/submissions`}
          className="text-zinc-600 underline underline-offset-4 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          매칭·확인 →
        </Link>
      </div>

      {/* 시트 열 매핑 모달(순차) */}
      {sheetJob && (
        <ColumnMapper
          key={sheetJob.job.path}
          filename={sheetJob.job.filename}
          headers={sheetJob.job.preview.headers}
          sampleRows={sheetJob.job.preview.sampleRows}
          initial={sheetJob.job.preview.suggested}
          busy={false}
          onConfirm={(m) => {
            sheetJob.resolve(m);
            setSheetJob(null);
          }}
          onCancel={() => {
            sheetJob.resolve(null);
            setSheetJob(null);
          }}
        />
      )}
    </div>
  );
}
