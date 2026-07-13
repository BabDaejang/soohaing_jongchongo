import { redirect } from "next/navigation";

// 구 평가 화면은 대시보드 페이즈 2로 흡수됐다(리팩토링 2 배치 7). 앵커로 리다이렉트한다.
// actions.ts는 대시보드 페이즈 2 패널이 계속 호출하므로 유지한다.
export default async function EvaluatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}#phase-2`);
}
