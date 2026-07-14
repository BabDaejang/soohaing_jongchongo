"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  addManualSubmission,
  approveExtraction,
  deleteOriginal,
  deleteSubmission,
  reassignSubmission,
  toggleInclude,
  updateSubmissionText,
  deleteSubmissionsByFile,
} from "@/app/projects/[id]/submissions/actions";
import { AuthenticityBadge } from "@/components/projects/authenticity-badge";
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
  authenticity: unknown;
};

export function StudentSubmissions({
  projectId,
  students,
  submissions,
}: {
  projectId: string;
  students: StudentOpt[];
  submissions: SubRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [manualAddStudentId, setManualAddStudentId] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");
  const [error, setError] = useState("");

  // unique source_filenames로 열 구성
  const filesSet = new Set<string>();
  for (const s of submissions) {
    if (s.source_filename) {
      filesSet.add(s.source_filename);
    }
  }
  const fileColumns = Array.from(filesSet).sort();

  // studentId -> filename -> SubRow[] 매핑 구조 생성
  const subMap = new Map<string, Map<string, SubRow[]>>();
  for (const s of submissions) {
    if (!s.student_id || !s.source_filename) continue;
    if (!subMap.has(s.student_id)) {
      subMap.set(s.student_id, new Map());
    }
    const studentFiles = subMap.get(s.student_id)!;
    if (!studentFiles.has(s.source_filename)) {
      studentFiles.set(s.source_filename, []);
    }
    studentFiles.get(s.source_filename)!.push(s);
  }

  const handleAddManual = (studentId: string) => {
    if (!manualText.trim()) return;
    start(async () => {
      setError("");
      try {
        await addManualSubmission(projectId, studentId, manualText);
        setManualText("");
        setManualAddStudentId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "수동 추가 실패");
      }
    });
  };

  const handleReassign = (subId: string, toStudentId: string) => {
    start(async () => {
      setError("");
      try {
        await reassignSubmission(projectId, subId, toStudentId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "귀속 변경 실패");
      }
    });
  };

  const handleDelete = (subId: string) => {
    start(async () => {
      setError("");
      try {
        await deleteSubmission(projectId, subId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "삭제 실패");
      }
    });
  };

  const handleUpdateText = async (subId: string, text: string) => {
    try {
      await updateSubmissionText(projectId, subId, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "텍스트 수정 실패");
      throw e;
    }
  };

  const handleDeleteColumn = (filename: string) => {
    if (
      confirm(
        `'${filename}' 열의 모든 학생 제출물 데이터를 일괄 삭제하시겠습니까?\n(데이터베이스 제출물 레코드가 지워지며 스토리지의 원본 분할 임시 파일도 지워집니다.)`
      )
    ) {
      start(async () => {
        setError("");
        try {
          await deleteSubmissionsByFile(projectId, filename);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "열 삭제 실패");
        }
      });
    }
  };

  if (students.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-8 text-center text-sm text-zinc-400 dark:border-zinc-700">
        등록된 학생이 없습니다. 대시보드 페이즈 1에서 명단을 먼저 등록하세요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 p-2.5 rounded-md border border-red-200 dark:border-red-900">
          {error}
        </p>
      )}

      {/* 표 컨테이너 (작업결과표 스타일 적용) */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm">
        <table className="w-full border-collapse text-sm min-w-[700px]">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-900 text-left border-b border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium">
              <th className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-center w-[100px] font-semibold">
                학번
              </th>
              <th className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-center w-[120px] font-semibold">
                이름
              </th>
              {fileColumns.map((file) => (
                <th
                  key={file}
                  className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 min-w-[280px] font-medium"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate max-w-[220px]" title={file}>
                      {file}
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleDeleteColumn(file)}
                      className="px-1.5 py-0.5 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded text-[10px] transition font-normal"
                    >
                      열 삭제
                    </button>
                  </div>
                </th>
              ))}
              {fileColumns.length === 0 && (
                <th className="px-3 py-2.5 text-zinc-400 font-normal">
                  수합된 파일이 없습니다.
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {students.map((student) => {
              const studentFiles = subMap.get(student.id);
              return (
                <tr
                  key={student.id}
                  className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40 transition-colors"
                >
                  {/* 학번 셀 */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-center font-mono text-zinc-500 dark:text-zinc-400">
                    {student.student_number || "-"}
                  </td>

                  {/* 이름 셀 + 수동추가 트리거 */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 sticky left-0 bg-white dark:bg-zinc-950 z-10">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {student.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setManualText("");
                          setManualAddStudentId(
                            manualAddStudentId === student.id ? null : student.id
                          );
                        }}
                        className="text-[10px] text-zinc-500 hover:text-zinc-800 underline dark:hover:text-zinc-300 whitespace-nowrap"
                      >
                        +수동
                      </button>
                    </div>

                    {/* 수동 추가 폼 */}
                    {manualAddStudentId === student.id && (
                      <div className="mt-2 border border-dashed border-zinc-300 dark:border-zinc-700 p-1.5 rounded bg-zinc-50 dark:bg-zinc-900/50 z-20">
                        <textarea
                          value={manualText}
                          onChange={(e) => setManualText(e.target.value)}
                          placeholder="제출물 내용 입력…"
                          className="w-full text-xs p-1 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-950 focus:outline-none"
                          rows={3}
                        />
                        <div className="flex justify-end gap-1 mt-1">
                          <button
                            type="button"
                            disabled={pending || !manualText.trim()}
                            onClick={() => handleAddManual(student.id)}
                            className="px-2 py-0.5 bg-zinc-800 text-white rounded text-[10px] hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
                          >
                            추가
                          </button>
                          <button
                            type="button"
                            onClick={() => setManualAddStudentId(null)}
                            className="px-2 py-0.5 border border-zinc-300 dark:border-zinc-700 rounded text-[10px] hover:bg-zinc-100"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    )}
                  </td>

                  {/* 파일 컬럼별 셀 */}
                  {fileColumns.map((file) => {
                    const cellSubs = studentFiles?.get(file) ?? [];
                    return (
                      <td
                        key={file}
                        className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2"
                      >
                        {cellSubs.map((sub) => (
                          <SubmissionCellBlock
                            key={sub.id}
                            projectId={projectId}
                            sub={sub}
                            students={students}
                            onReassign={handleReassign}
                            onDelete={handleDelete}
                            onUpdateText={handleUpdateText}
                            onToggleEval={(id, val) =>
                              void toggleInclude(projectId, id, "eval", val)
                            }
                            onToggleRecord={(id, val) =>
                              void toggleInclude(projectId, id, "record", val)
                            }
                          />
                        ))}
                      </td>
                    );
                  })}

                  {fileColumns.length === 0 && (
                    <td className="px-3 py-2 text-zinc-400 italic text-xs">
                      오른쪽 "+수동"을 눌러 제출물을 추가할 수 있습니다.
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 개별 제출물 셀 블록 컴포넌트 ──────────────────────────────────────────

function SubmissionCellBlock({
  projectId,
  sub,
  students,
  onReassign,
  onDelete,
  onUpdateText,
  onToggleEval,
  onToggleRecord,
}: {
  projectId: string;
  sub: SubRow;
  students: StudentOpt[];
  onReassign: (subId: string, toStudentId: string) => void;
  onDelete: (subId: string) => void;
  onUpdateText: (subId: string, text: string) => Promise<void>;
  onToggleEval: (subId: string, val: boolean) => void;
  onToggleRecord: (subId: string, val: boolean) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(sub.content_text);
  const [evalOn, setEvalOn] = useState(sub.include_in_eval);
  const [recordOn, setRecordOn] = useState(sub.include_in_record);
  const [pending, start] = useTransition();

  useEffect(() => {
    setEvalOn(sub.include_in_eval);
  }, [sub.include_in_eval]);

  useEffect(() => {
    setRecordOn(sub.include_in_record);
  }, [sub.include_in_record]);

  const handleSave = () => {
    start(async () => {
      await onUpdateText(sub.id, editText);
      setEditing(false);
      router.refresh();
    });
  };

  const handleApprove = () => {
    start(async () => {
      try {
        await approveExtraction(projectId, sub.id);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "승인 오류");
      }
    });
  };

  const handleDeleteOrig = () => {
    if (confirm("원본 파일을 영구 삭제하시겠습니까?")) {
      start(async () => {
        try {
          await deleteOriginal(projectId, sub.id);
          router.refresh();
        } catch (e) {
          alert(e instanceof Error ? e.message : "삭제 오류");
        }
      });
    }
  };

  const approved = !!sub.extraction_approved_at;

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded p-2 mb-1.5 bg-zinc-50/50 dark:bg-zinc-900/50 last:mb-0 shadow-sm text-xs font-normal">
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full text-xs p-1 border border-zinc-300 dark:border-zinc-700 rounded bg-white dark:bg-zinc-950 focus:outline-none"
            rows={4}
          />
          <div className="flex gap-1 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="px-2 py-0.5 bg-zinc-800 text-white rounded text-[10px] hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setEditText(sub.content_text);
                setEditing(false);
              }}
              className="px-2 py-0.5 border border-zinc-300 dark:border-zinc-700 rounded text-[10px] hover:bg-zinc-100"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {/* 제출물 내용 */}
          <div
            className="whitespace-pre-wrap max-h-28 overflow-y-auto text-zinc-700 dark:text-zinc-300 leading-normal"
            title={sub.content_text}
          >
            {sub.content_text || <span className="text-zinc-400 italic">(내용 없음)</span>}
          </div>

          {/* 메타데이터 및 토글 영역 */}
          <div className="flex flex-wrap items-center justify-between gap-1 pt-1 mt-1 border-t border-zinc-150 dark:border-zinc-800 text-[10px] text-zinc-500">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={evalOn}
                  onChange={(e) => {
                    setEvalOn(e.target.checked);
                    onToggleEval(sub.id, e.target.checked);
                  }}
                  className="h-3 w-3"
                />
                평가
              </label>
              <label className="flex items-center gap-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={recordOn}
                  onChange={(e) => {
                    setRecordOn(e.target.checked);
                    onToggleRecord(sub.id, e.target.checked);
                  }}
                  className="h-3 w-3"
                />
                생기부
              </label>
            </div>
            <AuthenticityBadge status={sub.authenticity_status} />
          </div>

          {/* 액션 컨트롤 영역 */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-dashed border-zinc-200 dark:border-zinc-800">
            {/* 귀속 이동 */}
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onReassign(sub.id, e.target.value);
                }
              }}
              className="text-[10px] px-1 py-0.5 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 rounded max-w-[90px] truncate"
            >
              <option value="">이동…</option>
              {students
                .filter((s) => s.id !== sub.student_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>

            {/* 원본 제어 */}
            <div className="flex items-center gap-1.5 text-[10px]">
              {sub.storage_path ? (
                approved ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={handleDeleteOrig}
                    className="text-amber-600 hover:text-amber-800 dark:hover:text-amber-400 underline"
                  >
                    원본삭제
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={handleApprove}
                    className="text-zinc-500 hover:text-zinc-700 underline"
                  >
                    추출승인
                  </button>
                )
              ) : (
                <span className="text-zinc-400">원본없음</span>
              )}

              {/* 기본 편집/삭제 */}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300 underline"
              >
                수정
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => onDelete(sub.id)}
                className="text-red-500 hover:text-red-700 underline"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
