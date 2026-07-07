import { GoogleSignInButton } from "@/components/google-sign-in-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">수행평가 수합·평가·생기부</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Google 계정으로 로그인해 주세요. 최초 로그인 시 가입 신청이 접수됩니다.
        </p>
      </div>
      <GoogleSignInButton />
      {error === "auth" && (
        <p className="text-sm text-red-600">
          로그인에 실패했습니다. 다시 시도해 주세요.
        </p>
      )}
    </main>
  );
}
