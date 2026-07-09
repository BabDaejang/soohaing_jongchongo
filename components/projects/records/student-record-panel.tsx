"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TeacherMemoBox } from "@/components/projects/teacher-memo-box";
import { CharCounter } from "./char-counter";
import { VerificationView } from "./verification-view";
import { VersionHistory } from "./version-history";
import { generateRecord } from "@/app/projects/[id]/records/actions";
import type { CountMethod, RecordOrigin } from "@/lib/supabase/types";
import type { StudentRow } from "./types";

const ORIGIN_LABEL: Record<RecordOrigin, string> = {
  generated: "생성",
  edited: "교사 편집",
  manual: "수동 작성",
};

// 학생별 생기부 패널: 정보 + 교사 메모 + 생성/재생성 + 검증 뷰 + 글자수 + 버전 이력.
export function StudentRecordPanel({
  projectId,
  charLimit,
  countMethod,
  student,
}: {
  projectId: string;
  charLimit: number;
  countMethod: CountMethod;
  student: StudentRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const record = student.record;

  function generate() {
    setError(null);
    startTransition(async () => {
      try {
        await generateRecord(projectId, student.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "생성 실패");
      }
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {student.name}
            {student.studentNumber && (
              <span className="ml-2 text-sm font-normal text-zinc-400">
                {student.studentNumber}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            반영 제출물 {student.reflectCount}건
            {record && ` · 현재 v${record.version} · ${ORIGIN_LABEL[record.origin]}`}
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="shrink-0 rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {pending ? "처리 중…" : record ? "재생성" : "생성"}
        </button>
      </div>

      {/* 교사 관찰 메모 — 상시 노출, 자동 저장(세션 4 필드 재사용) */}
      <TeacherMemoBox
        projectId={projectId}
        studentId={student.id}
        initialMemo={student.teacherMemo ?? ""}
      />

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {record ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500">생기부</span>
            <CharCounter
              text={record.content}
              charLimit={charLimit}
              initialMethod={countMethod}
            />
          </div>
          <VerificationView
            projectId={projectId}
            studentId={student.id}
            content={record.content}
            verification={record.verification}
            onChanged={() => router.refresh()}
          />
          <VersionHistory
            projectId={projectId}
            studentId={student.id}
            currentVersion={record.version}
          />
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-400">
          아직 생성된 생기부가 없습니다. 반영 제출물이나 교사 메모를 근거로 생성하세요.
        </p>
      )}
    </div>
  );
}
