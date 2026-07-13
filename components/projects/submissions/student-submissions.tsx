"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addManualSubmission,
  approveExtraction,
  deleteOriginal,
  deleteSubmission,
  reassignSubmission,
  toggleInclude,
  updateSubmissionText,
} from "@/app/projects/[id]/submissions/actions";
import { AuthenticityBadge } from "@/components/projects/authenticity-badge";
import type { Finding } from "@/lib/factsheet/authenticity";
import type {
  AuthenticityStatus,
  IdentitySource,
  MatchMethod,
  SubmissionSourceType,
} from "@/lib/supabase/types";

type StudentOpt = { id: string; student_number: string | null; name: string };

export type SubRow = {
  id: string;
  student_id: string | null;
  source_filename: string | null;
  source_type: SubmissionSourceType;
  content_text: string;
  match_method: MatchMethod | null;
  identity_source: IdentitySource | null;
  include_in_eval: boolean;
  include_in_record: boolean;
  storage_path: string | null;
  extraction_approved_at: string | null;
  authenticity_status: AuthenticityStatus;
  authenticity: unknown; // { claim, urls, findings, factsheet_id, model, checked_at, content_hash }
};

// 진실성 리포트(authenticity jsonb)에서 findings·출처 요약을 안전하게 뽑는다.
type AuthReport = { claim?: { title?: string | null }; findings?: Finding[] };
function readAuthReport(raw: unknown): AuthReport {
  return raw && typeof raw === "object" ? (raw as AuthReport) : {};
}

const VERDICT_LABEL: Record<Finding["verdict"], string> = {
  supported: "부합",
  contradicted: "모순",
  not_found: "근거 없음",
};

const METHOD_LABEL: Record<MatchMethod, string> = {
  auto_number: "학번 자동",
  auto_name: "이름 자동",
  auto_new_number: "신규 학번 자동",
  confirmed_existing: "교사 확정",
  confirmed_new: "교사 신규",
  manual: "수동 입력",
  reassigned: "교사 재귀속",
};

// 자동 귀속의 근거를 교사가 훑어볼 수 있도록 식별값 출처를 함께 보여준다 (SPEC 5.2).
const SOURCE_LABEL: Record<IdentitySource, string> = {
  column: "열",
  filename: "파일명",
  llm: "LLM 추정",
};

// LLM 추정으로 자동 귀속된 건은 눈에 띄게 — 가장 검토가 필요한 경로다.
const AUTO_METHODS: ReadonlySet<MatchMethod> = new Set([
  "auto_number",
  "auto_name",
  "auto_new_number",
]);

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
const ghostBtn =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

export function StudentSubmissions({
  projectId,
  students,
  submissions,
}: {
  projectId: string;
  students: StudentOpt[];
  submissions: SubRow[];
}) {
  const byStudent = new Map<string, SubRow[]>();
  for (const s of submissions) {
    if (!s.student_id) continue;
    const arr = byStudent.get(s.student_id) ?? [];
    arr.push(s);
    byStudent.set(s.student_id, arr);
  }

  const withData = students.filter((s) => byStudent.has(s.id));
  if (withData.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
        아직 학생에 귀속된 제출물이 없습니다. 매칭을 실행하고 확인 큐에서 확정하세요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {withData.map((student) => (
        <StudentGroup
          key={student.id}
          projectId={projectId}
          student={student}
          students={students}
          rows={byStudent.get(student.id) ?? []}
        />
      ))}
    </div>
  );
}

function StudentGroup({
  projectId,
  student,
  students,
  rows,
}: {
  projectId: string;
  student: StudentOpt;
  students: StudentOpt[];
  rows: SubRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const addManual = () =>
    start(async () => {
      await addManualSubmission(projectId, student.id, text);
      setText("");
      setAdding(false);
      router.refresh();
    });

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">
          {student.student_number && (
            <span className="mr-2 font-mono text-zinc-500">{student.student_number}</span>
          )}
          {student.name}
          <span className="ml-2 text-xs text-zinc-400">제출물 {rows.length}</span>
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)} className={ghostBtn}>
          수동 추가
        </button>
      </div>

      {adding && (
        <div className="mb-3 rounded border border-dashed border-zinc-300 p-2 dark:border-zinc-700">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="제출물 내용을 직접 입력"
            className={`${inputClass} w-full resize-y`}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className={ghostBtn}>
              취소
            </button>
            <button
              type="button"
              disabled={pending || !text.trim()}
              onClick={addManual}
              className="rounded-md bg-zinc-800 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
            >
              추가
            </button>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <SubmissionRow key={row.id} projectId={projectId} row={row} students={students} />
        ))}
      </ul>
    </div>
  );
}

function SubmissionRow({
  projectId,
  row,
  students,
}: {
  projectId: string;
  row: SubRow;
  students: StudentOpt[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [text, setText] = useState(row.content_text);
  const [evalOn, setEvalOn] = useState(row.include_in_eval);
  const [recordOn, setRecordOn] = useState(row.include_in_record);
  const [showFindings, setShowFindings] = useState(false);
  const [error, setError] = useState("");

  // 진실성 근거(의심·판정 불가만 펼침) — 조치는 기존 수단(반영 해제·재귀속·점수 보정)으로 교사가 결정.
  const findings = readAuthReport(row.authenticity).findings ?? [];
  const canExpandAuth =
    (row.authenticity_status === "suspect" ||
      row.authenticity_status === "unverifiable") &&
    findings.length > 0;

  const act = (fn: () => Promise<void>, refresh = true) =>
    start(async () => {
      setError("");
      try {
        await fn();
        if (refresh) router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "처리 실패");
      }
    });

  const approved = !!row.extraction_approved_at;

  return (
    <li className="rounded border border-zinc-100 p-3 dark:border-zinc-800">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{row.source_type}</span>
        {row.match_method && (
          <span
            className={
              row.identity_source === "llm" && AUTO_METHODS.has(row.match_method)
                ? "rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                : ""
            }
          >
            {METHOD_LABEL[row.match_method]}
            {row.identity_source && ` · ${SOURCE_LABEL[row.identity_source]}`}
          </span>
        )}
        {row.source_filename && <span>{row.source_filename}</span>}
        {canExpandAuth ? (
          <button
            type="button"
            onClick={() => setShowFindings((v) => !v)}
            className="inline-flex items-center"
          >
            <AuthenticityBadge status={row.authenticity_status} />
            <span className="ml-1 underline underline-offset-2">
              {showFindings ? "근거 접기" : "근거 보기"}
            </span>
          </button>
        ) : (
          <AuthenticityBadge status={row.authenticity_status} />
        )}
      </div>

      {showFindings && canExpandAuth && (
        <div className="mb-2 flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
          {findings.map((f, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="flex items-start gap-1.5">
                <span
                  className={`shrink-0 rounded px-1 py-0.5 font-medium ${
                    f.verdict === "contradicted"
                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                      : f.verdict === "supported"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {VERDICT_LABEL[f.verdict]}
                </span>
                <span className="text-zinc-700 dark:text-zinc-200">{f.claim}</span>
              </div>
              {f.quote && (
                <p className="border-l-2 border-zinc-300 pl-2 text-zinc-500 dark:border-zinc-700">
                  “{f.quote}”
                </p>
              )}
              {f.url && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="w-fit text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  출처 원문 →
                </a>
              )}
            </div>
          ))}
          <p className="text-zinc-400">
            진실성 판정은 참고용 플래그입니다. 필요하면 평가 반영 해제·다른 학생으로 이동·점수
            보정으로 교사가 조치하세요(자동 조치 없음).
          </p>
        </div>
      )}

      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className={`${inputClass} w-full resize-y`}
        />
      ) : (
        <p className={`text-sm text-zinc-600 dark:text-zinc-300 ${expanded ? "" : "line-clamp-2"}`}>
          {row.content_text || "(빈 내용)"}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1 text-zinc-500">
          <input
            type="checkbox"
            checked={evalOn}
            onChange={(e) => {
              setEvalOn(e.target.checked);
              act(() => toggleInclude(projectId, row.id, "eval", e.target.checked), false);
            }}
          />
          평가 반영
        </label>
        <label className="flex items-center gap-1 text-zinc-500">
          <input
            type="checkbox"
            checked={recordOn}
            onChange={(e) => {
              setRecordOn(e.target.checked);
              act(() => toggleInclude(projectId, row.id, "record", e.target.checked), false);
            }}
          />
          생기부 반영
        </label>

        {!editing && (
          <button type="button" onClick={() => setExpanded((v) => !v)} className={ghostBtn}>
            {expanded ? "접기" : "전체"}
          </button>
        )}
        {editing ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(async () => { await updateSubmissionText(projectId, row.id, text); setEditing(false); })}
              className={ghostBtn}
            >
              저장
            </button>
            <button type="button" onClick={() => { setText(row.content_text); setEditing(false); }} className={ghostBtn}>
              취소
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className={ghostBtn}>
            수정
          </button>
        )}
        {!editing && !moving && (
          <button
            type="button"
            onClick={() => {
              setMoveTo("");
              setMoving(true);
            }}
            className={ghostBtn}
          >
            다른 학생으로 이동
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm("이 제출물을 삭제할까요?")) act(() => deleteSubmission(projectId, row.id));
          }}
          className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          삭제
        </button>

        {/* 원본 파일: 추출 확인 후에만 삭제 가능 (INV-5) */}
        {row.storage_path ? (
          approved ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm("원본 파일을 삭제할까요? 되돌릴 수 없습니다.")) act(() => deleteOriginal(projectId, row.id));
              }}
              className={ghostBtn}
            >
              원본 삭제
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => approveExtraction(projectId, row.id))}
              className={ghostBtn}
            >
              추출 확인(승인)
            </button>
          )
        ) : (
          <span className="text-zinc-300 dark:text-zinc-600">원본 없음</span>
        )}
        {approved && row.storage_path && <span className="text-emerald-600 dark:text-emerald-500">승인됨</span>}
      </div>

      {/* 재귀속 (SPEC 5.4) — 자동 귀속이 틀렸을 때 교사가 바로잡는 경로. 채점·생기부는 재계산이 필요해진다. */}
      {moving && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950">
          <span className="text-amber-800 dark:text-amber-300">옮길 학생</span>
          <select
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            className={inputClass}
          >
            <option value="">— 선택 —</option>
            {students
              .filter((s) => s.id !== row.student_id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.student_number ? `${s.student_number} ` : ""}
                  {s.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={pending || !moveTo}
            onClick={() =>
              act(async () => {
                await reassignSubmission(projectId, row.id, moveTo);
                setMoving(false);
              })
            }
            className={ghostBtn}
          >
            {pending ? "이동 중…" : "이동"}
          </button>
          <button type="button" onClick={() => setMoving(false)} className={ghostBtn}>
            취소
          </button>
          <span className="text-amber-700 dark:text-amber-400">
            이동하면 채점·생기부를 다시 계산해야 합니다.
          </span>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}
