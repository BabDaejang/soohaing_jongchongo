"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  computeStandings,
  GRADE_BOUNDARIES,
  type Standing,
} from "@/lib/grading";
import {
  setScoreOverride,
  clearScoreOverride,
  updateGradingScheme,
} from "@/app/projects/[id]/evaluate/actions";
import type { GradingScheme, TieBreak } from "@/lib/supabase/types";

export type ScoreRow = {
  studentId: string;
  name: string;
  studentNumber: string | null;
  composite: number;
  effective: number;
  override: number | null;
  overrideReason: string | null;
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export function ResultsTable({
  projectId,
  rows,
  initialScheme,
  tieBreak,
}: {
  projectId: string;
  rows: ScoreRow[];
  initialScheme: GradingScheme;
  tieBreak: TieBreak;
}) {
  const router = useRouter();
  const [scheme, setScheme] = useState<GradingScheme>(initialScheme);
  const [, startTransition] = useTransition();

  // 등급·석차는 저장값이 아니라 effective_score에서 파생 계산한다(INV-6). 배치와 동일 순수 함수를
  // 써서 등급제(5/9) 토글이 재계산 없이 즉시·일관되게 반영된다.
  const standings: Standing[] = useMemo(
    () => computeStandings(rows.map((r) => r.effective), scheme, tieBreak),
    [rows, scheme, tieBreak],
  );

  const ranked = useMemo(() => {
    return rows
      .map((r, i) => ({ ...r, rank: standings[i].rank, grade: standings[i].grade }))
      .sort((a, b) => a.rank - b.rank || b.effective - a.effective);
  }, [rows, standings]);

  // 등급 분포 요약(등급별 인원 + 경계=해당 등급 최저 반영점수).
  const distribution = useMemo(() => {
    const count = GRADE_BOUNDARIES[scheme].length;
    const buckets = Array.from({ length: count }, () => ({
      n: 0,
      min: Infinity,
    }));
    for (const r of ranked) {
      const b = buckets[r.grade - 1];
      b.n += 1;
      b.min = Math.min(b.min, r.effective);
    }
    return buckets;
  }, [ranked, scheme]);

  function onToggleScheme(next: GradingScheme) {
    if (next === scheme) return;
    setScheme(next); // 즉시 화면 반영(파생)
    startTransition(async () => {
      await updateGradingScheme(projectId, next); // 설정 영속화
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        아직 순위가 없습니다. 위에서 <b>채점 실행</b>을 눌러 제출물을 평가하세요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 등급제 토글 */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-zinc-500">등급제</span>
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {(["grade5", "grade9"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onToggleScheme(g)}
              className={`px-3 py-1 ${
                scheme === g
                  ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                  : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
              }`}
            >
              {g === "grade5" ? "5등급" : "9등급"}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-400">화면 즉시 반영(점수에서 파생)</span>
      </div>

      {/* 등급 분포 요약 */}
      <div className="flex flex-wrap gap-2">
        {distribution.map((b, i) => (
          <div
            key={i}
            className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
          >
            <span className="font-semibold">{i + 1}등급</span>{" "}
            <span className="text-zinc-500">· {b.n}명</span>
            {b.n > 0 && (
              <span className="text-zinc-400"> · 경계 {fmt(b.min)}점</span>
            )}
          </div>
        ))}
      </div>

      {/* 결과표 */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">석차</th>
              <th className="px-3 py-2 font-medium">학생</th>
              <th className="px-3 py-2 font-medium">합성 점수</th>
              <th className="px-3 py-2 font-medium">반영 점수</th>
              <th className="px-3 py-2 font-medium">등급</th>
              <th className="px-3 py-2 font-medium">교사 보정</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <Row
                key={r.studentId}
                projectId={projectId}
                row={r}
                rank={r.rank}
                grade={r.grade}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  projectId,
  row,
  rank,
  grade,
}: {
  projectId: string;
  row: ScoreRow;
  rank: number;
  grade: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.override ?? row.composite));
  const [reason, setReason] = useState(row.overrideReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const num = Number(value);
    if (!Number.isFinite(num)) {
      setError("숫자를 입력하세요.");
      return;
    }
    if (!reason.trim()) {
      setError("보정 사유는 필수입니다.");
      return;
    }
    startTransition(async () => {
      try {
        await setScoreOverride(projectId, row.studentId, num, reason);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장 실패");
      }
    });
  }

  function clear() {
    startTransition(async () => {
      try {
        await clearScoreOverride(projectId, row.studentId);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "해제 실패");
      }
    });
  }

  return (
    <tr className="border-t border-zinc-100 align-top dark:border-zinc-800">
      <td className="px-3 py-2 tabular-nums text-zinc-500">{rank}</td>
      <td className="px-3 py-2">
        <div className="font-medium">{row.name}</div>
        {row.studentNumber && (
          <div className="text-xs text-zinc-400">{row.studentNumber}</div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-zinc-500">{fmt(row.composite)}</td>
      <td className="px-3 py-2 tabular-nums">
        <span className="font-medium">{fmt(row.effective)}</span>
        {row.override !== null && (
          <div className="mt-0.5 flex items-center gap-1">
            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              교사보정
            </span>
            {row.overrideReason && <ReasonText text={row.overrideReason} />}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <span className="font-semibold">{grade}등급</span>
      </td>
      <td className="px-3 py-2">
        {!editing ? (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {row.override !== null ? "수정" : "보정"}
            </button>
            {row.override !== null && (
              <button
                type="button"
                onClick={clear}
                disabled={pending}
                className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                해제
              </button>
            )}
          </div>
        ) : (
          <div className="flex w-56 flex-col gap-1.5">
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="반영 점수"
              className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="보정 사유(필수)"
              rows={2}
              className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            {error && <span className="text-[11px] text-red-600">{error}</span>}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900"
              >
                {pending ? "저장 중…" : "적용"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

// 사유 메모: 기본은 앞 몇 글자만, 클릭하면 전체 표시(UX — 메모칸을 작게).
function ReasonText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const short = text.length > 12 ? text.slice(0, 12) + "…" : text;
  return (
    <button
      type="button"
      title="클릭하여 전체 보기"
      onClick={() => setOpen((v) => !v)}
      className="text-left text-[11px] text-zinc-500 underline decoration-dotted underline-offset-2"
    >
      {open ? text : short}
    </button>
  );
}
