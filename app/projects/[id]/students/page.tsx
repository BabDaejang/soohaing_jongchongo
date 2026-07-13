import { redirect } from "next/navigation";

// 구 학생 명단 화면은 대시보드 하단 작업결과표로 흡수됨(리팩토링 2 배치 4).
// 학생 추가·수정·삭제·메모는 작업결과표의 셀·모달에서 수행한다.
export default async function StudentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}#worksheet`);
}
