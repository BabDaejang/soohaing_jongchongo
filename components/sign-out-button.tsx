// 로그아웃 — 단순 form POST라 클라이언트 컴포넌트가 필요 없다.
export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="text-sm text-zinc-500 underline underline-offset-4 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        로그아웃
      </button>
    </form>
  );
}
