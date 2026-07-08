"use client";

import { useState } from "react";
import { updateWaitingMessage } from "@/app/admin/actions";

// 미승인 사용자 대기 화면 안내문 편집기 (SPEC 2절, app_settings.waiting_message).
export function WaitingMessageEditor({ message }: { message: string }) {
  const [value, setValue] = useState(message);

  return (
    <form
      action={updateWaitingMessage}
      className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <textarea
        name="message"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        className="w-full resize-y rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-800 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        placeholder="가입 승인 대기 중 사용자에게 보여줄 안내문"
      />
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          저장
        </button>
      </div>
    </form>
  );
}
