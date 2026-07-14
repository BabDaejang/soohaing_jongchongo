"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
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

// Flattened row structure representing a submission or an empty slot for a student
type SubRowExtended = SubRow & {
  student_number: string | null;
  student_name: string;
  isEmptyRow?: boolean;
};

// Authenticity JSON format
interface Finding {
  claim: string;
  verdict: "supported" | "contradicted" | "not_found";
  entry_id: string | null;
  url: string | null;
  quote: string;
}

interface AuthenticityJson {
  claim?: {
    kind: "book" | "article" | "paper" | "webpage" | "none";
    title: string | null;
    author: string | null;
  };
  findings?: Finding[];
}

const STATUS_PRIORITY: Record<string, number> = {
  suspect: 1,        // 의심
  unverifiable: 2,   // 판정 불가
  verified: 3,       // 통과
  unverified: 4,     // 미검증
  not_applicable: 5, // 해당 없음
};

const STATUS_LABELS: Record<string, string> = {
  suspect: "의심",
  unverifiable: "판정 불가",
  verified: "통과",
  unverified: "미검증",
  not_applicable: "해당 없음",
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
  const [error, setError] = useState("");

  // UI States
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addingText, setAddingText] = useState("");
  const [activeFilterCol, setActiveFilterCol] = useState<string | null>(null);

  // 1. Flatten rows: 1 row per submission, plus 1 empty row for students with no submissions
  const rows = useMemo<SubRowExtended[]>(() => {
    const list: SubRowExtended[] = [];
    const studentsWithSubs = new Set<string>();

    // Process actual matched submissions
    for (const s of submissions) {
      if (s.student_id) {
        studentsWithSubs.add(s.student_id);
        const student = students.find((st) => st.id === s.student_id);
        list.push({
          ...s,
          student_number: student?.student_number ?? null,
          student_name: student?.name ?? "알 수 없음",
        });
      }
    }

    // Add empty rows for students who have no submissions
    for (const student of students) {
      if (!studentsWithSubs.has(student.id)) {
        list.push({
          id: `empty-${student.id}`,
          student_id: student.id,
          student_number: student.student_number,
          student_name: student.name,
          source_filename: null,
          source_type: "manual",
          content_text: "",
          match_method: null,
          identity_source: null,
          include_in_eval: false,
          include_in_record: false,
          storage_path: null,
          extraction_approved_at: null,
          authenticity_status: "not_applicable",
          authenticity: null,
          isEmptyRow: true,
        });
      }
    }

    return list;
  }, [students, submissions]);

  // Unique source filenames for file control list at the top
  const fileColumns = useMemo(() => {
    const files = new Set<string>();
    for (const s of submissions) {
      if (s.source_filename) {
        files.add(s.source_filename);
      }
    }
    return Array.from(files).sort();
  }, [submissions]);

  // Width states (restoring from localStorage if present)
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`submissions-table-widths-${projectId}`);
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    return {
      student_number: 100,
      name: 120,
      source_filename: 200,
      content_text: 350,
      authenticity_status: 120,
      authenticity_reason: 500,
      actions: 200,
    };
  });

  // Sorting state (default: sort by authenticity status prioritize suspect -> unverifiable)
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>({
    key: "authenticity_status",
    dir: "asc",
  });

  // Filtering state
  const [filters, setFilters] = useState<Record<string, string[]>>({});

  // Outside click close popover
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (activeFilterCol && !(e.target as HTMLElement).closest(".filter-popover-container")) {
        setActiveFilterCol(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [activeFilterCol]);

  // Handle column resizing
  const handleResizeStart = (colKey: string, startEvent: React.MouseEvent) => {
    startEvent.preventDefault();
    const startWidth = widths[colKey] ?? 100;
    const startX = startEvent.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(60, Math.min(1500, startWidth + deltaX));
      setWidths((prev) => {
        const updated = { ...prev, [colKey]: newWidth };
        localStorage.setItem(`submissions-table-widths-${projectId}`, JSON.stringify(updated));
        return updated;
      });
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Unique values calculation for dropdown filters
  const uniqueValues = useMemo(() => {
    const vals: Record<string, string[]> = {
      student_number: [],
      name: [],
      source_filename: [],
      authenticity_status: [],
    };
    const sets = {
      student_number: new Set<string>(),
      name: new Set<string>(),
      source_filename: new Set<string>(),
      authenticity_status: new Set<string>(),
    };

    for (const r of rows) {
      if (r.student_number) sets.student_number.add(r.student_number);
      if (r.student_name) sets.name.add(r.student_name);
      if (r.source_filename) sets.source_filename.add(r.source_filename);
      sets.authenticity_status.add(r.authenticity_status);
    }

    vals.student_number = Array.from(sets.student_number).sort();
    vals.name = Array.from(sets.name).sort();
    vals.source_filename = Array.from(sets.source_filename).sort();
    vals.authenticity_status = Array.from(sets.authenticity_status).sort();
    return vals;
  }, [rows]);

  // Toggle filter option
  const handleFilterToggle = (colKey: string, val: string, checked: boolean) => {
    setFilters((prev) => {
      const vals = prev[colKey] ? [...prev[colKey]] : [];
      if (checked) {
        if (!vals.includes(val)) vals.push(val);
      } else {
        const idx = vals.indexOf(val);
        if (idx > -1) vals.splice(idx, 1);
      }
      return { ...prev, [colKey]: vals };
    });
  };

  // Clear specific column filters
  const handleClearFilter = (colKey: string) => {
    setFilters((prev) => {
      const updated = { ...prev };
      delete updated[colKey];
      return updated;
    });
  };

  // Toggle sort key and direction
  const handleSortToggle = (colKey: string) => {
    setSort((prev) => {
      if (prev?.key === colKey) {
        if (prev.dir === "asc") return { key: colKey, dir: "desc" };
        return null; // toggle off
      }
      return { key: colKey, dir: "asc" };
    });
  };

  // Apply filters
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      for (const [key, selectedVals] of Object.entries(filters)) {
        if (!selectedVals || selectedVals.length === 0) continue;
        let cellVal = "";
        if (key === "student_number") cellVal = r.student_number ?? "";
        else if (key === "name") cellVal = r.student_name ?? "";
        else if (key === "source_filename") cellVal = r.source_filename ?? "";
        else if (key === "authenticity_status") cellVal = r.authenticity_status ?? "";

        if (!selectedVals.includes(cellVal)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  // Apply sort
  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    if (!sort) return list;

    const { key, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      if (key === "authenticity_status") {
        const priA = STATUS_PRIORITY[a.authenticity_status] ?? 99;
        const priB = STATUS_PRIORITY[b.authenticity_status] ?? 99;
        if (priA !== priB) return (priA - priB) * factor;
      }

      let valA: any = "";
      let valB: any = "";

      if (key === "student_number") {
        valA = a.student_number ?? "";
        valB = b.student_number ?? "";
      } else if (key === "name") {
        valA = a.student_name ?? "";
        valB = b.student_name ?? "";
      } else if (key === "source_filename") {
        valA = a.source_filename ?? "";
        valB = b.source_filename ?? "";
      } else if (key === "content_text") {
        valA = a.isEmptyRow ? "" : (a.content_text ?? "");
        valB = b.isEmptyRow ? "" : (b.content_text ?? "");
      }

      if (valA === valB) return 0;
      return valA.toString().localeCompare(valB.toString(), "ko", { numeric: true }) * factor;
    });

    return list;
  }, [filteredRows, sort]);

  // Actions
  const handleAddManual = (studentId: string) => {
    if (!addingText.trim()) return;
    start(async () => {
      setError("");
      try {
        await addManualSubmission(projectId, studentId, addingText);
        setAddingText("");
        setAddingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "수동 추가 실패");
      }
    });
  };

  const handleSaveEdit = (subId: string) => {
    start(async () => {
      setError("");
      try {
        await updateSubmissionText(projectId, subId, editText);
        setEditingId(null);
        setEditText("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "수정 실패");
      }
    });
  };

  const handleReassign = (subId: string, toStudentId: string) => {
    if (!toStudentId) return;
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
    if (!confirm("제출물을 영구 삭제하시겠습니까?")) return;
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

  const handleApprove = (subId: string) => {
    start(async () => {
      try {
        await approveExtraction(projectId, subId);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "승인 오류");
      }
    });
  };

  const handleDeleteOrig = (subId: string) => {
    if (confirm("원본 파일을 영구 삭제하시겠습니까?")) {
      start(async () => {
        try {
          await deleteOriginal(projectId, subId);
          router.refresh();
        } catch (e) {
          alert(e instanceof Error ? e.message : "삭제 오류");
        }
      });
    }
  };

  const handleDeleteColumn = (filename: string) => {
    if (
      confirm(
        `'${filename}' 파일의 모든 학생 제출물 데이터를 일괄 삭제하시겠습니까?\n(데이터베이스 제출물 레코드가 지워지며 스토리지의 원본 분할 임시 파일도 지워집니다.)`
      )
    ) {
      start(async () => {
        setError("");
        try {
          await deleteSubmissionsByFile(projectId, filename);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "삭제 실패");
        }
      });
    }
  };

  // Render authenticity findings with colored text/background highlights
  const renderFindings = (row: SubRowExtended) => {
    if (row.isEmptyRow) return <span className="text-zinc-400 italic">제출물 없음</span>;
    if (row.authenticity_status === "unverified") return <span className="text-zinc-400">진실성 검증 전입니다.</span>;
    if (row.authenticity_status === "unverifiable") return <span className="text-amber-600 font-medium">출처 식별 불가로 진실성 검증을 수행할 수 없습니다.</span>;

    const auth = row.authenticity as AuthenticityJson | null;
    const findings = auth?.findings ?? [];

    if (findings.length === 0) {
      return <span className="text-zinc-400 italic">— (대조 결과 없음)</span>;
    }

    return (
      <div className="flex flex-col gap-1.5 py-1">
        {findings.map((f, i) => {
          let badgeClass = "";
          let verdictLabel = "";
          let highlightTextClass = "";

          if (f.verdict === "contradicted") {
            badgeClass = "border border-red-200 bg-red-50 text-red-700";
            verdictLabel = "의심";
            highlightTextClass = "bg-red-50 text-red-800 font-bold px-1 rounded border-b border-red-300 whitespace-pre-wrap";
          } else if (f.verdict === "not_found") {
            badgeClass = "border border-amber-200 bg-amber-50 text-amber-800";
            verdictLabel = "확인 불가";
            highlightTextClass = "bg-amber-50 text-amber-900 px-1 rounded border-b border-amber-300 whitespace-pre-wrap";
          } else {
            badgeClass = "border border-green-200 bg-green-50 text-green-700";
            verdictLabel = "확인 완료";
            highlightTextClass = "bg-green-50 text-green-900 px-1 rounded border-b border-green-200 whitespace-pre-wrap";
          }

          return (
            <div key={i} className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 p-2 text-xs rounded">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className={`px-1 py-0.5 text-[10px] rounded font-bold ${badgeClass}`}>
                  {verdictLabel}
                </span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  주장: <span className={highlightTextClass}>{f.claim}</span>
                </span>
              </div>
              {f.quote && (
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 pl-2 border-l-2 border-zinc-300 bg-white/40 py-0.5 italic">
                  근거 인용: "{f.quote}"
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="text-sm font-bold text-red-700 bg-red-50 p-3 rounded border border-red-200">
          ⚠️ {error}
        </p>
      )}

      {/* Top section: Uploaded files batch delete */}
      {fileColumns.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center text-xs font-semibold border border-zinc-200 bg-zinc-50 p-3 rounded-md">
          <span className="bg-zinc-800 text-white px-2 py-0.5 rounded text-[10px] uppercase">수합 파일 삭제 관리</span>
          {fileColumns.map((file) => (
            <div key={file} className="flex items-center gap-1.5 border border-zinc-300 bg-white px-2 py-1 rounded text-zinc-700 shadow-sm">
              <span className="truncate max-w-[200px]" title={file}>{file}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleDeleteColumn(file)}
                className="text-red-600 hover:text-red-800 font-bold cursor-pointer border-l border-zinc-200 pl-1.5 ml-1"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Grid spreadsheet container (WorksheetTable style - clean grey borders, no Neo-Brutalism) */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm table-fixed">
          <thead>
            <tr className="bg-zinc-100 dark:bg-zinc-900 text-left border-b border-zinc-200 dark:border-zinc-800 font-semibold text-zinc-700 dark:text-zinc-300">
              {/* Columns Header with resize, sort, and filter */}
              {[
                { key: "student_number", label: "학번", filterable: true },
                { key: "name", label: "이름", filterable: true },
                { key: "source_filename", label: "파일명", filterable: true },
                { key: "content_text", label: "제출 내용", filterable: false },
                { key: "authenticity_status", label: "진실성 판정", filterable: true },
                { key: "authenticity_reason", label: "판정 사유", filterable: false },
                { key: "actions", label: "작업", filterable: false },
              ].map((col) => {
                const width = widths[col.key] ?? 100;
                const isFiltered = filters[col.key]?.length > 0;
                const isSorted = sort?.key === col.key;

                return (
                  <th
                    key={col.key}
                    style={{ width }}
                    className="relative border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 font-semibold select-none text-xs tracking-tight bg-zinc-50 dark:bg-zinc-900/60"
                  >
                    <div className="flex items-center justify-between gap-1">
                      {/* Sort toggler */}
                      <span
                        onClick={() => handleSortToggle(col.key)}
                        className="cursor-pointer hover:underline flex items-center gap-1 truncate text-zinc-700 dark:text-zinc-300 font-semibold"
                      >
                        {col.label}
                        {isSorted && (sort.dir === "asc" ? " ▲" : " ▼")}
                      </span>

                      {/* Filter popover container */}
                      {col.filterable && (
                        <div className="relative filter-popover-container">
                          <button
                            type="button"
                            onClick={() => setActiveFilterCol(activeFilterCol === col.key ? null : col.key)}
                            className={`px-1.5 py-0.5 border border-zinc-300 rounded text-[10px] font-bold hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all cursor-pointer ${
                              isFiltered ? "bg-zinc-800 text-white border-zinc-800" : "bg-white text-zinc-700"
                            }`}
                          >
                            필터
                          </button>
                          {activeFilterCol === col.key && (
                            <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-2 text-left text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                              <div className="flex items-center justify-between border-b border-zinc-200 pb-1 mb-1 font-bold">
                                <span>필터 선택</span>
                                <button
                                  type="button"
                                  onClick={() => handleClearFilter(col.key)}
                                  className="underline hover:text-zinc-800 font-bold text-zinc-500"
                                >
                                  초기화
                                </button>
                              </div>
                              <div className="max-h-48 overflow-y-auto flex flex-col gap-1 py-1">
                                {uniqueValues[col.key]?.map((val) => (
                                  <label key={val} className="flex items-center gap-1.5 cursor-pointer hover:bg-zinc-50 py-0.5 px-1">
                                    <input
                                      type="checkbox"
                                      checked={filters[col.key]?.includes(val) ?? false}
                                      onChange={(e) => handleFilterToggle(col.key, val, e.target.checked)}
                                      className="h-3.5 w-3.5 border border-zinc-300 rounded"
                                    />
                                    <span className="truncate">{(STATUS_LABELS[val] ?? val) || "(빈 값)"}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => handleResizeStart(col.key, e)}
                      className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-zinc-300 active:bg-zinc-400"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sortedRows.map((row) => {
              const approved = !!row.extraction_approved_at;

              // Render custom high-visibility authenticity badges (Clean standard styled badges)
              let badgeColor = "";
              let statusText = "";
              if (row.isEmptyRow) {
                badgeColor = "border border-zinc-200 bg-zinc-50 text-zinc-400";
                statusText = "미제출";
              } else if (row.authenticity_status === "suspect") {
                badgeColor = "border border-red-200 bg-red-50 text-red-700 font-semibold";
                statusText = "의심";
              } else if (row.authenticity_status === "unverifiable") {
                badgeColor = "border border-amber-200 bg-amber-50 text-amber-800 font-semibold";
                statusText = "판정 불가";
              } else if (row.authenticity_status === "verified") {
                badgeColor = "border border-green-200 bg-green-50 text-green-700 font-semibold";
                statusText = "통과";
              } else if (row.authenticity_status === "unverified") {
                badgeColor = "border border-zinc-200 bg-zinc-50 text-zinc-500 font-semibold";
                statusText = "미검증";
              } else {
                badgeColor = "border border-zinc-200 bg-zinc-50 text-zinc-400";
                statusText = "해당 없음";
              }

              return (
                <tr
                  key={row.id}
                  className={`align-top hover:bg-zinc-50/50 transition-colors ${
                    row.authenticity_status === "suspect"
                      ? "bg-red-50/10"
                      : row.authenticity_status === "unverifiable"
                      ? "bg-amber-50/5"
                      : ""
                  }`}
                >
                  {/* 학번 셀 */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 font-mono text-zinc-500">
                    {row.student_number || "-"}
                  </td>

                  {/* 이름 셀 */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 font-semibold text-zinc-800 dark:text-zinc-200">
                    {row.student_name}
                  </td>

                  {/* 파일명 셀 */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-xs truncate max-w-[200px]" title={row.source_filename ?? ""}>
                    {row.source_filename || <span className="text-zinc-300">—</span>}
                  </td>

                  {/* 제출 내용 셀 (높이 제한 없이 늘어나는 셀) */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-xs">
                    {row.isEmptyRow ? (
                      addingId === row.student_id ? (
                        <div className="flex flex-col gap-1.5">
                          <textarea
                            value={addingText}
                            onChange={(e) => setAddingText(e.target.value)}
                            placeholder="수동 제출 내용 입력…"
                            className="w-full text-xs p-2 border border-zinc-300 rounded focus:outline-none bg-white font-mono shadow-sm"
                            rows={4}
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={pending || !addingText.trim()}
                              onClick={() => handleAddManual(row.student_id!)}
                              className="px-2 py-1 bg-zinc-800 text-white rounded text-[10px] hover:bg-zinc-700 transition cursor-pointer font-bold"
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAddingId(null);
                                setAddingText("");
                              }}
                              className="px-2 py-1 border border-zinc-300 rounded text-[10px] hover:bg-zinc-50 bg-white text-zinc-700 font-bold transition cursor-pointer"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-zinc-400 italic">제출물 없음</span>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingId(row.student_id);
                              setAddingText("");
                            }}
                            className="mt-1 px-2.5 py-1 bg-zinc-800 text-white text-xs font-bold hover:bg-zinc-700 transition cursor-pointer rounded"
                          >
                            + 수동 추가
                          </button>
                        </div>
                      )
                    ) : editingId === row.id ? (
                      <div className="flex flex-col gap-1.5">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full text-xs p-2 border border-zinc-300 rounded focus:outline-none bg-white font-mono shadow-sm"
                          rows={6}
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleSaveEdit(row.id)}
                            className="px-2.5 py-1 bg-zinc-800 text-white rounded text-[10px] hover:bg-zinc-700 font-bold transition cursor-pointer"
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditText("");
                            }}
                            className="px-2.5 py-1 border border-zinc-300 rounded text-[10px] hover:bg-zinc-50 bg-white text-zinc-700 font-bold transition cursor-pointer"
                          >
                            취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="whitespace-pre-wrap font-mono leading-relaxed cursor-pointer hover:bg-zinc-50 p-1 border border-transparent hover:border-zinc-200 rounded"
                        onClick={() => {
                          setEditingId(row.id);
                          setEditText(row.content_text);
                        }}
                        title="클릭하여 내용 수정"
                      >
                        {row.content_text || <span className="text-zinc-400 italic">(내용 없음)</span>}
                      </div>
                    )}
                  </td>

                  {/* 진실성 판정 셀 */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5 text-center">
                    <span className={`inline-block px-2.5 py-0.5 rounded text-xs select-none ${badgeColor}`}>
                      {statusText}
                    </span>
                  </td>

                  {/* 판정 사유 셀 (findings & 하이라이트 포함) */}
                  <td className="border-r border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
                    {renderFindings(row)}
                  </td>

                  {/* 작업 및 제어 셀 */}
                  <td className="px-3 py-2.5 text-xs">
                    {!row.isEmptyRow ? (
                      <div className="flex flex-col gap-2">
                        {/* 평가/생기부 토글 체크박스 */}
                        <div className="flex items-center gap-3 border border-zinc-200 bg-zinc-50 p-1.5 rounded font-semibold text-[11px] justify-around">
                          <label className="flex items-center gap-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              defaultChecked={row.include_in_eval}
                              onChange={(e) => void toggleInclude(projectId, row.id, "eval", e.target.checked)}
                              className="h-3.5 w-3.5 border border-zinc-300 rounded"
                            />
                            평가
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              defaultChecked={row.include_in_record}
                              onChange={(e) => void toggleInclude(projectId, row.id, "record", e.target.checked)}
                              className="h-3.5 w-3.5 border border-zinc-300 rounded"
                            />
                            생기부
                          </label>
                        </div>

                        {/* 귀속 이동 드롭다운 */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-zinc-400">학생 귀속 변경:</span>
                          <select
                            value=""
                            onChange={(e) => handleReassign(row.id, e.target.value)}
                            disabled={pending}
                            className="text-xs px-2 py-1 border border-zinc-300 bg-white font-medium rounded focus:outline-none w-full text-zinc-700 hover:border-zinc-400 cursor-pointer"
                          >
                            <option value="">학생 선택 이동…</option>
                            {students
                              .filter((s) => s.id !== row.student_id)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} ({s.student_number || "학번 없음"})
                                </option>
                              ))}
                          </select>
                        </div>

                        {/* 원본 관리 및 삭제 액션 */}
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-[10px] font-bold justify-end border-t border-dashed border-zinc-200 pt-1.5">
                          {row.storage_path ? (
                            approved ? (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => handleDeleteOrig(row.id)}
                                className="text-amber-600 hover:text-amber-800 underline cursor-pointer"
                              >
                                원본삭제
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => handleApprove(row.id)}
                                className="text-zinc-500 hover:text-zinc-700 underline cursor-pointer"
                              >
                                추출승인
                              </button>
                            )
                          ) : (
                            <span className="text-zinc-400">원본없음</span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(row.id);
                              setEditText(row.content_text);
                            }}
                            className="text-zinc-500 hover:text-zinc-800 underline cursor-pointer"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleDelete(row.id)}
                            className="text-red-500 hover:text-red-700 underline cursor-pointer"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-zinc-400 italic text-[11px] text-center font-semibold">
                        수합된 제출물이 없습니다.
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center font-semibold text-zinc-400">
                  제출물 목록이 비어있거나 필터 조건에 맞는 학생이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
