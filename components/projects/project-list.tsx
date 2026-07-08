"use client";

import { useState } from "react";
import Link from "next/link";
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
          >
            + 새 프로젝트
          </button>
        )}
      </div>

      {showCreate && (
        <form
          action={createProject}
          className="rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              프로젝트 이름
              <input
                name="name"
                required
                autoFocus
                placeholder="예: 1학기 과학 탐구 보고서"
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              설명 (선택)
              <textarea
                name="description"
                rows={2}
                placeholder="이 수행평가에 대한 간단한 설명"
                className="resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              만들기
            </button>
          </div>
        </form>
      )}

      {projects.length === 0 && !showCreate ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-400 dark:border-zinc-700">
          아직 프로젝트가 없습니다. 위 &ldquo;새 프로젝트&rdquo; 버튼으로
          첫 수행평가를 시작하세요.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <form action={updateProject} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            이름
            <input
              name="name"
              required
              defaultValue={project.name}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-500">
            설명
            <textarea
              name="description"
              rows={2}
              defaultValue={project.description ?? ""}
              className="resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              저장
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="group relative flex flex-col rounded-lg border border-zinc-200 transition hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
      <Link href={`/projects/${project.id}`} className="flex-1 p-4">
        <div className="font-medium">{project.name}</div>
        {project.description && (
          <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
            {project.description}
          </p>
        )}
      </Link>
      <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          수정
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
            className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            삭제
          </button>
        </form>
      </div>
    </li>
  );
}
