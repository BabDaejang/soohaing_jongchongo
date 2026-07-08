"use client";

import { useFormStatus } from "react-dom";
import { updateProjectSettings } from "@/app/projects/actions";
import type {
  CountMethod,
  FileRetentionDays,
  GradingScheme,
  ScoreAggregation,
  TieBreak,
} from "@/lib/supabase/types";

type SettingsProps = {
  id: string;
  grading_scheme: GradingScheme;
  char_limit: number;
  count_method: CountMethod;
  score_aggregation: ScoreAggregation;
  tie_break: TieBreak;
  file_retention_days: FileRetentionDays;
};

const selectClass =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function SettingsForm({ project }: { project: SettingsProps }) {
  const retentionValue =
    project.file_retention_days === null
      ? "off"
      : String(project.file_retention_days);

  return (
    <form
      action={updateProjectSettings}
      className="flex flex-col gap-6 rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"
    >
      <input type="hidden" name="projectId" value={project.id} />

      <Field
        label="등급제"
        help="상대평가 등급 체계 (SPEC 6절). 화면에서 언제든 전환 가능."
      >
        <select
          name="grading_scheme"
          defaultValue={project.grading_scheme}
          className={selectClass}
        >
          <option value="grade5">5등급</option>
          <option value="grade9">9등급 (스테나인)</option>
        </select>
      </Field>

      <Field
        label="생기부 글자수 제한"
        help="기본 500자. 카운트 방식에 따라 공백 포함 글자수 또는 바이트로 셉니다."
      >
        <div className="flex items-center gap-2">
          <input
            name="char_limit"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={project.char_limit}
            className={`${selectClass} w-32`}
          />
          <select
            name="count_method"
            defaultValue={project.count_method}
            className={selectClass}
          >
            <option value="chars">글자수(공백 포함)</option>
            <option value="bytes">바이트(한글 3바이트)</option>
          </select>
        </div>
      </Field>

      <Field
        label="합성 점수 방식"
        help="제출물별 점수를 학생 점수로 합치는 방식 (SPEC 6절). 가중은 루브릭 가중치 사용."
      >
        <select
          name="score_aggregation"
          defaultValue={project.score_aggregation}
          className={selectClass}
        >
          <option value="sum">합</option>
          <option value="avg">평균</option>
          <option value="weighted">가중</option>
        </select>
      </Field>

      <Field
        label="동점자 처리"
        help="합성 점수가 같을 때의 등급 처리 (SPEC 6절)."
      >
        <select
          name="tie_break"
          defaultValue={project.tie_break}
          className={selectClass}
        >
          <option value="best_grade">상위 등급 부여</option>
          <option value="mid_rank">중간석차 방식</option>
        </select>
      </Field>

      <Field
        label="원본 파일 자동 삭제"
        help="추출 텍스트 확인(승인) 후에만 삭제됩니다. 자동 삭제도 이 승인 조건을 우선합니다 (INV-5)."
      >
        <select
          name="file_retention_days"
          defaultValue={retentionValue}
          className={selectClass}
        >
          <option value="off">끄기 (수동 삭제만)</option>
          <option value="7">7일 후</option>
          <option value="30">30일 후</option>
        </select>
      </Field>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
    >
      {pending ? "저장 중…" : "설정 저장"}
    </button>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      <span className="text-xs text-zinc-400">{help}</span>
    </div>
  );
}
