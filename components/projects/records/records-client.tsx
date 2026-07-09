"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StudentRecordPanel } from "./student-record-panel";
import { generateRecord } from "@/app/projects/[id]/records/actions";
import type { CountMethod } from "@/lib/supabase/types";
import type { StudentRow } from "./types";

type BatchState = {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  failed: number;
};

// Phase 3 생기부 화면 클라이언트. 학생 사이드바 + 선택 패널 + 일괄 생성.
// 일괄 생성은 학생별 generateRecord를 **순차 단일 호출**한다(INV-1: 배열 시그니처 함수 없음).
export function RecordsClient({
  projectId,
  charLimit,
  countMethod,
  students,
}: {
  projectId: string;
  charLimit: number;
  countMethod: CountMethod;
  students: StudentRow[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    students[0]?.id ?? null,
  );
  const [batch, setBatch] = useState<BatchState>({
    running: false,
    done: 0,
    total: 0,
    current: null,
    failed: 0,
  });

  const selected = students.find((s) => s.id === selectedId) ?? null;

  async function generateAll() {
    const targets = students.filter((s) => s.reflectCount > 0 || s.teacherMemo);
    setBatch({
      running: true,
      done: 0,
      total: targets.length,
      current: null,
      failed: 0,
    });
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      setBatch((b) => ({ ...b, done: i, current: targets[i].name }));
      try {
        // 학생 한 명 = 호출 한 번 (INV-1).
        await generateRecord(projectId, targets[i].id);
      } catch {
        failed += 1;
      }
    }
    setBatch({
      running: false,
      done: targets.length,
      total: targets.length,
      current: null,
      failed,
    });
    router.refresh();
  }

  const generatedCount = students.filter((s) => s.record).length;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={generateAll}
            disabled={batch.running || students.length === 0}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            {batch.running ? "생성 중…" : "전체 생성"}
          </button>
          <span className="text-xs text-zinc-500">
            학생 {students.length}명 중 {generatedCount}명 생성됨. 전체 생성은
            학생별로 한 명씩 순차 처리합니다.
          </span>
        </div>
        {batch.running && (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {batch.done} / {batch.total}
              {batch.current && ` · ${batch.current} 처리 중…`}
            </p>
          </div>
        )}
        {!batch.running && batch.total > 0 && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            전체 생성 완료 — {batch.total}명 처리
            {batch.failed > 0 && ` · 실패 ${batch.failed}명`}
          </p>
        )}
      </div>

      {students.length === 0 ? (
        <p className="text-sm text-zinc-500">
          학생이 없습니다. 먼저 학생 명단을 추가하세요.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <aside className="flex flex-col gap-1">
            {students.map((s) => {
              const unsupported =
                s.record?.verification?.filter(
                  (v) => !v.grounded && !v.teacher_edited,
                ).length ?? 0;
              const active = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${
                    active
                      ? "border-zinc-400 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span className="truncate">
                    {s.name}
                    {s.studentNumber && (
                      <span className="ml-1 text-xs text-zinc-400">
                        {s.studentNumber}
                      </span>
                    )}
                  </span>
                  <span className="ml-2 flex shrink-0 items-center gap-1">
                    {s.record ? (
                      <span className="text-xs text-zinc-400">
                        v{s.record.version}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-300 dark:text-zinc-600">
                        미생성
                      </span>
                    )}
                    {unsupported > 0 && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-red-500"
                        title={`근거 없는 문장 ${unsupported}개`}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </aside>

          <div>
            {selected && (
              <StudentRecordPanel
                key={selected.id}
                projectId={projectId}
                charLimit={charLimit}
                countMethod={countMethod}
                student={selected}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
