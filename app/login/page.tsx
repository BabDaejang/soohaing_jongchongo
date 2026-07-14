import { GoogleSignInButton } from "@/components/google-sign-in-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 bg-grid-pattern">
      <div className="border-4 border-black bg-white p-8 shadow-neo-md text-center max-w-md rotate-[-0.5deg] flex flex-col items-center gap-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-black">수행평가 수합·평가·생기부</h1>
          <p className="mt-3 text-sm font-bold text-black/80">
            Google 계정으로 로그인해 주세요. 최초 로그인 시 가입 신청이 접수됩니다.
          </p>
        </div>
        <GoogleSignInButton />
        {error === "auth" && (
          <p className="border-2 border-black bg-red-100 px-4 py-2 text-sm font-bold text-red-700 shadow-neo-sm mt-2">
            로그인에 실패했습니다. 다시 시도해 주세요.
          </p>
        )}
      </div>
    </main>
  );
}
