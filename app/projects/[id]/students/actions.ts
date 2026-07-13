"use server";

import { revalidatePath } from "next/cache";
import { requireProjectOwner } from "@/lib/projects";

// Postgres unique_violation → 학번 중복(students_project_number_uniq).
const UNIQUE_VIOLATION = "23505";

function studentNumberOrNull(formData: FormData): string | null {
  const raw = String(formData.get("student_number") ?? "").trim();
  return raw || null;
}

// ── 학생 수동 추가 ────────────────────────────────────────────────────
export async function addStudent(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const { supabase } = await requireProjectOwner(projectId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("학생 이름을 입력하세요.");
  const student_number = studentNumberOrNull(formData);

  const { error } = await supabase
    .from("students")
    .insert({ project_id: projectId, name, student_number });
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error("이미 존재하는 학번입니다.");
    }
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}`);
}

// ── 학생 정보 수정 (이름·학번) ────────────────────────────────────────
export async function updateStudent(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const studentId = String(formData.get("studentId"));
  const { supabase } = await requireProjectOwner(projectId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("학생 이름을 입력하세요.");
  const student_number = studentNumberOrNull(formData);

  const { error } = await supabase
    .from("students")
    .update({ name, student_number })
    .eq("id", studentId)
    .eq("project_id", projectId);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new Error("이미 존재하는 학번입니다.");
    }
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}`);
}

// ── 학생 삭제 ─────────────────────────────────────────────────────────
export async function deleteStudent(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const studentId = String(formData.get("studentId"));
  const { supabase } = await requireProjectOwner(projectId);

  const { error } = await supabase
    .from("students")
    .delete()
    .eq("id", studentId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${projectId}`);
}

// ── 교사 관찰 메모 자동 저장 (SPEC 7.4) ──────────────────────────────
// 학생 목록 화면의 메모 박스에서 디바운스 후 호출된다. 성공/실패만 반환.
export async function saveTeacherMemo(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const studentId = String(formData.get("studentId"));
  const { supabase } = await requireProjectOwner(projectId);

  const memo = String(formData.get("teacher_memo") ?? "");
  const { error } = await supabase
    .from("students")
    .update({ teacher_memo: memo || null })
    .eq("id", studentId)
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  // 자동 저장이므로 revalidate 불필요 (동일 값 재로드 방지).
}
