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

  const remove = async (path: string, filename: string, ingested: boolean) => {
    setErrors([]);
    if (ingested) {
      if (!confirm(`'${filename}' 파일은 이미 수합되었습니다. 원본 파일을 삭제하여 용량을 확보하시겠습니까?\n(수합된 제출물 텍스트 데이터는 유지됩니다.)`)) {
        return;
      }
    }
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
    "border-4 border-black bg-neo-accent text-white px-5 py-2.5 font-black shadow-neo-md hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-60 cursor-pointer text-sm uppercase tracking-wide flex items-center gap-2";

  return (
    <div className="flex flex-col gap-6">
      {/* ① 실행 컨트롤 */}
      <div className="flex flex-col gap-3">
        <OcrModelSelect
          projectId={projectId}
          providers={providers}
          extract={extract}
        />
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
        className={`border-4 border-dashed px-6 py-10 text-center transition shadow-neo-sm ${
          dragOver
            ? "border-black bg-neo-secondary"
            : "border-black bg-white"
        }`}
      >
        <p className="text-sm font-bold text-black">
          파일을 여기로 끌어다 놓거나
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploadBusy}
            className="mx-2 font-black underline underline-offset-4 text-black hover:text-neo-accent disabled:opacity-60 cursor-pointer"
          >
            선택
          </button>
          하세요. 업로드만 하고, 토큰은 [수합 & 매칭] 실행 때 소모됩니다.
        </p>
        <p className="mt-2 text-xs font-bold text-black/60">
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
        <p className="text-sm font-bold text-black">
          <span className="animate-pulse text-neo-accent font-black">● </span>
          {uploadStatus || "처리 중…"}
        </p>
      )}

      {errors.length > 0 && (
        <ul className="border-4 border-black bg-red-100 p-4 text-sm font-bold text-red-700 shadow-neo-sm">
          {errors.map((e, i) => (
            <li key={i} className="list-disc list-inside">{e}</li>
          ))}
        </ul>
      )}

      {/* ④ 업로드 파일 목록 */}
      <div className="flex flex-col gap-3">
        <h3 className="text-md font-black uppercase text-black">업로드된 파일 ({files.length})</h3>
        {files.length === 0 ? (
          <p className="border-4 border-dashed border-black bg-white px-6 py-8 text-center text-sm font-bold text-black/50 shadow-neo-sm">
            아직 업로드된 파일이 없습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((f) => (
              <li
                key={f.path}
                className="flex flex-wrap items-center gap-3 border-4 border-black bg-white px-4 py-3 text-sm font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all"
              >
                <input
                  type="checkbox"
                  checked={checked.has(f.path)}
                  onChange={() => toggle(f.path)}
                  className="h-5 w-5 border-4 border-black accent-black cursor-pointer"
                />
                <span className="flex-1 truncate text-black font-bold" title={f.filename}>
                  {f.filename}
                </span>
                {f.createdAt && (
                  <span className="text-xs font-bold text-black/60">
                    {new Date(f.createdAt).toLocaleString("ko-KR")}
                  </span>
                )}
                {f.ingested && (
                  <span className="border-2 border-black bg-[#C8E6C9] px-2 py-0.5 text-xs font-black text-black">
                    수합됨
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void remove(f.path, f.filename, f.ingested)}
                  disabled={running}
                  className="border-2 border-black bg-neo-accent text-white px-3 py-1 text-xs font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none transition-all disabled:opacity-40 cursor-pointer"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ⑤ [수합 & 매칭] 실행 컨트롤 영역 (이동됨) */}
      <div className="flex flex-wrap items-center gap-4 border-t-4 border-black pt-4">
        <button type="button" onClick={onRun} disabled={running || preparing} className={btn}>
          {running ? "수합·매칭 중…" : preparing ? "준비 중…" : "수합 & 매칭"}
        </button>
        {progress && running && (
          <span className="border-2 border-black bg-neo-muted px-2 py-1 text-xs font-black text-black shadow-neo-sm">
            진행 {progress.done}/{progress.total}
          </span>
        )}
        <span className="text-xs font-bold text-black/70 flex-1">
          체크한 파일을 수합한 뒤 자동으로 학생 매칭을 이어서 실행합니다. 진행 중 일시정지·재개·긴급 중단할 수 있고, 중단해도 처리분은 반영됩니다.
        </span>
      </div>

      {/* ⑥ 확인 대기 배지 + 매칭·확인 링크 */}
      <div className="flex items-center gap-3 text-sm mt-2 border-t-2 border-black pt-3">
        {pendingCount > 0 && (
          <span className="border-2 border-black bg-neo-secondary px-3 py-1 text-xs font-black text-black shadow-neo-sm rotate-[1deg]">
            확인 대기 {pendingCount}건
          </span>
        )}
        <Link
          href={`/projects/${projectId}/submissions`}
          className="font-black text-black underline underline-offset-4 hover:text-neo-accent"
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
