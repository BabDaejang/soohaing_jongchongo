import { redirect } from "next/navigation";

// 수합 실행 UI는 프로젝트 대시보드 페이즈 1로 통합됐다(리팩토링 2 배치 6).
// 액션(actions.ts)은 대시보드가 재사용하므로 폴더는 유지한다.
export default async function IngestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}#phase-1`);
}
