"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Google OAuth 로그인 버튼. 추가 스코프를 지정하지 않는다 — 기본 email·profile만 (SPEC 2절).
export function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setLoading(false);
      alert("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignIn}
      disabled={loading}
      className="rounded-lg border border-zinc-300 bg-white px-6 py-3 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      {loading ? "이동 중…" : "Google로 로그인"}
    </button>
  );
}
