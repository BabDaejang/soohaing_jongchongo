"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Plus, Trash2, Edit, Save, X } from "lucide-react";
import {
  createProject,
  updateProject,
  deleteProject,
} from "@/app/projects/actions";

type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
};

export function ProjectList({ projects }: { projects: ProjectSummary[] }) {
  const [showCreate, setShowCreate] = useState(false);
  // 서버 응답 대기 중 재제출을 동기적으로 차단. useFormStatus의 pending은
  // 재렌더 후에야 버튼을 비활성화하므로, 그 사이의 연타는 ref로 막는다
  // (중복 클릭 1회당 프로젝트 1개가 중복 생성되는 버그 방지).
  const creatingRef = useRef(false);

  async function handleCreate(formData: FormData) {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      await createProject(formData);
      setShowCreate(false);
    } finally {
      creatingRef.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="border-4 border-black bg-neo-secondary text-black px-5 py-2.5 font-black shadow-neo-md hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all cursor-pointer flex items-center gap-2 uppercase tracking-wide"
          >
            <Plus size={18} strokeWidth={3} /> 새 프로젝트
          </button>
        )}
      </div>

      {showCreate && (
        <form
          action={handleCreate}
          className="border-4 border-black bg-white p-6 shadow-neo-md rotate-[0.5deg]"
        >
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-black uppercase flex items-center gap-2 border-b-2 border-black pb-2">
              <Plus size={18} strokeWidth={3} /> 새 수행평가 프로젝트 생성
            </h3>
            <label className="flex flex-col gap-1 text-sm font-black uppercase text-black">
              프로젝트 이름
              <input
                name="name"
                required
                autoFocus
                placeholder="예: 1학기 과학 탐구 보고서"
                className="w-full border-4 border-black bg-white px-3 py-2 text-base font-bold placeholder:text-black/40 focus:bg-neo-secondary focus:shadow-neo-sm focus:outline-none transition-all"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-black uppercase text-black">
              설명 (선택)
              <textarea
                name="description"
                rows={2}
                placeholder="이 수행평가에 대한 간단한 설명"
                className="w-full resize-y border-4 border-black bg-white px-3 py-2 text-base font-bold placeholder:text-black/40 focus:bg-neo-secondary focus:shadow-neo-sm focus:outline-none transition-all"
              />
            </label>
          </div>
          <CreateFormFooter onCancel={() => setShowCreate(false)} />
        </form>
      )}

      {projects.length === 0 && !showCreate ? (
        <div className="border-4 border-dashed border-black bg-white px-6 py-12 text-center font-bold text-black/60 shadow-neo-md">
          아직 프로젝트가 없습니다. 우측 상단의 &ldquo;새 프로젝트&rdquo; 버튼으로 첫 수행평가를 시작하세요.
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

// 생성 폼 하단 버튼
function CreateFormFooter({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="mt-4 flex justify-end gap-3 border-t-2 border-black pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="border-2 border-black bg-white px-4 py-2 text-sm font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-60 cursor-pointer flex items-center gap-1"
      >
        <X size={16} strokeWidth={3} /> 취소
      </button>
      <button
        type="submit"
        disabled={pending}
        className="border-2 border-black bg-neo-accent text-white px-4 py-2 text-sm font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-60 cursor-pointer flex items-center gap-1"
      >
        <Save size={16} strokeWidth={3} /> {pending ? "만드는 중…" : "만들기"}
      </button>
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="border-4 border-black bg-white p-5 shadow-neo-md rotate-[-0.5deg]">
        <form action={updateProject} className="flex flex-col gap-4">
          <input type="hidden" name="projectId" value={project.id} />
          <h3 className="text-md font-black uppercase flex items-center gap-2 border-b-2 border-black pb-2">
            <Edit size={16} strokeWidth={3} /> 프로젝트 정보 수정
          </h3>
          <label className="flex flex-col gap-1 text-sm font-black uppercase text-black">
            이름
            <input
              name="name"
              required
              defaultValue={project.name}
              className="w-full border-4 border-black bg-white px-3 py-2 text-base font-bold focus:bg-neo-secondary focus:shadow-neo-sm focus:outline-none transition-all"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-black uppercase text-black">
            설명
            <textarea
              name="description"
              rows={2}
              defaultValue={project.description ?? ""}
              className="w-full resize-y border-4 border-black bg-white px-3 py-2 text-base font-bold focus:bg-neo-secondary focus:shadow-neo-sm focus:outline-none transition-all"
            />
          </label>
          <div className="flex justify-end gap-3 border-t-2 border-black pt-4">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border-2 border-black bg-white px-3 py-1.5 text-sm font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer flex items-center gap-1"
            >
              <X size={14} strokeWidth={3} /> 취소
            </button>
            <button
              type="submit"
              className="border-2 border-black bg-neo-accent text-white px-3 py-1.5 text-sm font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer flex items-center gap-1"
            >
              <Save size={14} strokeWidth={3} /> 저장
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="group relative flex flex-col border-4 border-black bg-white shadow-neo-md hover:-translate-y-1.5 hover:shadow-neo-lg transition-all duration-200">
      <Link href={`/projects/${project.id}`} className="flex-1 p-5">
        <div className="text-xl font-black uppercase tracking-tight text-black group-hover:text-neo-accent transition-colors">
          {project.name}
        </div>
        {project.description && (
          <p className="mt-2 line-clamp-2 text-sm font-bold text-black/70">
            {project.description}
          </p>
        )}
      </Link>
      <div className="flex justify-end gap-3 border-t-4 border-black bg-neo-muted/10 px-5 py-3">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="border-2 border-black bg-neo-secondary px-3 py-1.5 text-xs font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer flex items-center gap-1 text-black"
        >
          <Edit size={12} strokeWidth={3} /> 수정
        </button>
        <form
          action={deleteProject}
          onSubmit={(e) => {
            if (
              !confirm(
                `"${project.name}" 프로젝트를 삭제합니다. 학생·루브릭·설정이 모두 함께 삭제되며 되돌릴 수 없습니다. 계속할까요?`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="projectId" value={project.id} />
          <button
            type="submit"
            className="border-2 border-black bg-neo-accent text-white px-3 py-1.5 text-xs font-bold shadow-neo-sm hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer flex items-center gap-1"
          >
            <Trash2 size={12} strokeWidth={3} /> 삭제
          </button>
        </form>
      </div>
    </li>
  );
}
