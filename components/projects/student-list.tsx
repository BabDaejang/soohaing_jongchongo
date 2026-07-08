"use client";

import { useState } from "react";
import {
  addStudent,
  updateStudent,
  deleteStudent,
} from "@/app/projects/[id]/students/actions";
import { TeacherMemoBox } from "@/components/projects/teacher-memo-box";
import type { Student } from "@/lib/supabase/types";

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function StudentList({
  projectId,
  students,
}: {
  projectId: string;
  students: Student[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <form
        action={addStudent}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          학번 (선택)
          <input
            name="student_number"
            placeholder="예: 10203"
            className={`${inputClass} w-32`}
          />
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-500">
          이름
          <input name="name" required placeholder="학생 이름" className={inputClass} />
        </label>
        <button
          type="submit"
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          학생 추가
        </button>
      </form>

      {students.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">
          아직 등록된 학생이 없습니다. 위에서 학생을 추가하세요.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {students.map((s) => (
            <StudentRow key={s.id} projectId={projectId} student={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StudentRow({
  projectId,
  student,
}: {
  projectId: string;
  student: Student;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {editing ? (
        <form
          action={updateStudent}
          onSubmit={() => setEditing(false)}
          className="flex flex-wrap items-end gap-2"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="studentId" value={student.id} />
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            학번
            <input
              name="student_number"
              defaultValue={student.student_number ?? ""}
              className={`${inputClass} w-32`}
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-500">
            이름
            <input
              name="name"
              required
              defaultValue={student.name}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            취소
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            {student.student_number && (
              <span className="font-mono text-sm text-zinc-500">
                {student.student_number}
              </span>
            )}
            <span className="font-medium">{student.name}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              수정
            </button>
            <form
              action={deleteStudent}
              onSubmit={(e) => {
                if (
                  !confirm(
                    `${student.name} 학생을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="studentId" value={student.id} />
              <button
                type="submit"
                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                삭제
              </button>
            </form>
          </div>
        </div>
      )}

      <TeacherMemoBox
        projectId={projectId}
        studentId={student.id}
        initialMemo={student.teacher_memo ?? ""}
      />
    </li>
  );
}
