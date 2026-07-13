import { redirect } from "next/navigation";

// 구 결과 표는 대시보드 하단 작업결과표로 흡수됨(리팩토링 2 배치 4).
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}#worksheet`);
}
