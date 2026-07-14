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
      className="border-4 border-black bg-neo-secondary text-black px-6 py-3.5 text-base font-black shadow-neo-md hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-60 cursor-pointer uppercase tracking-wider"
    >
      {loading ? "이동 중…" : "Google로 로그인"}
    </button>
  );
}
