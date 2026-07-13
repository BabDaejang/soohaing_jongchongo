"use client";

import { useState } from "react";
import { StudentRecordPanel } from "./student-record-panel";
import type { CountMethod } from "@/lib/supabase/types";
import type { StudentRow } from "./types";

// Phase 3 생기부 화면 클라이언트. 학생 사이드바 + 선택 패널(개별 생성·검증·버전).
// 일괄 생성은 대시보드 페이즈 3 실행 터미널로 이동했다(중복 실행 창구 금지 — 배치 7).
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
  const [selectedId, setSelectedId] = useState<string | null>(
    students[0]?.id ?? null,
  );

  const selected = students.find((s) => s.id === selectedId) ?? null;

  const generatedCount = students.filter((s) => s.record).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-4 text-xs text-zinc-500 dark:border-zinc-800">
        <span>
          학생 {students.length}명 중 {generatedCount}명 생성됨.
        </span>
        <span className="text-zinc-400">
          일괄 생성은 프로젝트 대시보드 페이즈 3에서 실행하세요. 아래에서 학생별로 개별
          생성·검증·편집할 수 있습니다.
        </span>
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
