// 로그아웃 — 단순 form POST라 클라이언트 컴포넌트가 필요 없다.
export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="text-sm font-bold border-2 border-black bg-neo-accent text-white px-3 py-1.5 shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer"
      >
        로그아웃
      </button>
    </form>
  );
}
