"use client";

import { useRef, useState } from "react";
import { saveTeacherMemo } from "@/app/projects/[id]/students/actions";

type SaveState = "idle" | "editing" | "saving" | "saved" | "error";

const STATE_LABEL: Record<SaveState, string> = {
  idle: "",
  editing: "입력 중…",
  saving: "저장 중…",
  saved: "저장됨",
  error: "저장 실패 — 다시 시도하세요",
};

// 교사 관찰 메모 입력 박스 (SPEC 7.4). 입력이 멈추면 디바운스 후 자동 저장한다.
export function TeacherMemoBox({
  projectId,
  studentId,
  initialMemo,
}: {
  projectId: string;
  studentId: string;
  initialMemo: string;
}) {
  const [value, setValue] = useState(initialMemo);
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(initialMemo);

  const save = async (next: string) => {
    if (next === lastSaved.current) {
      setState("saved");
      return;
    }
    setState("saving");
    try {
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("studentId", studentId);
      fd.set("teacher_memo", next);
      await saveTeacherMemo(fd);
      lastSaved.current = next;
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const onChange = (next: string) => {
    setValue(next);
    setState("editing");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), 800);
  };

  const onBlur = () => {
    // 포커스를 벗어나면 대기 중인 디바운스를 즉시 확정 저장.
    if (timer.current) clearTimeout(timer.current);
    void save(value);
  };

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-zinc-400">교사 관찰 메모</span>
        <span
          className={`text-xs ${
            state === "error" ? "text-red-500" : "text-zinc-400"
          }`}
        >
          {STATE_LABEL[state]}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={2}
        placeholder="이 학생에 대한 관찰 내용을 적어두면 생기부 생성 시 참고됩니다."
        className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
    </div>
  );
}
