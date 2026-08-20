"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listDiscoveredStudents,
  createDiscoveredStudents,
} from "@/app/projects/[id]/submissions/actions";
import { emitWorksheetRefresh } from "@/lib/worksheet/refresh";
import type { DiscoveredStudent, IdentitySource } from "@/lib/matching";

// 발견 학생 검토·일괄 승인 (리팩토링 4 배치 2, P-1).
// 발견 스테이지가 채운 raw 식별값을 학생 후보로 모아 보여 주고, 교사가 고른 것만 명단에
// 올린다. **여기를 거치지 않고 학생이 생기는 경로는 없다**(유령 학생 방지).

const SOURCE_LABEL: Record<IdentitySource, string> = {
  column: "열",
  filename: "파일명",
  llm: "LLM",
};

// 행 식별 키 — 집계와 같은 규칙(학번 우선, 없으면 이름).
function rowKey(row: DiscoveredStudent): string {
  return row.no ? `no:${row.no}` : `name:${row.name ?? ""}`;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "알 수 없는 오류";
}

export function DiscoveryReview({
  projectId,
  reloadToken,
  onCountChange,
}: {
  projectId: string;
  /** 값이 바뀌면 목록을 다시 읽는다(실행 종료 시 Phase1Panel이 올린다). */
  reloadToken: number;
  /** 대기 인원 보고. **참조가 안정된 함수**여야 한다(useState setter 등) — 조회 effect의 의존성. */
  onCountChange?: (count: number) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DiscoveredStudent[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nameChoice, setNameChoice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // 수동 새로고침·승인 직후 재조회 트리거(effect 의존성으로만 조회한다 —
  // 조회 경로를 하나로 두어 중복 요청·경쟁 상태를 만들지 않는다).
  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = () => {
    setLoading(true);
    setReloadNonce((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    listDiscoveredStudents(projectId)
      .then((list) => {
        if (cancelled) return;
        setRows(list);
        setSelected(new Set(list.map(rowKey))); // 기본 전체 선택
        setNameChoice({});
        setError(null);
        onCountChange?.(list.length);
      })
      .catch((e) => {
        if (!cancelled) setError(msg(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true; // 언마운트·재조회 시 늦게 도착한 응답 무시
    };
  }, [projectId, reloadToken, reloadNonce, onCountChange]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allChecked = rows.length > 0 && selected.size === rows.length;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const picks = rows
        .filter((r) => selected.has(rowKey(r)))
        .map((r) => ({
          no: r.no,
          name: nameChoice[rowKey(r)] ?? r.name ?? "",
        }));
      if (picks.length === 0) {
        setError("명단에 추가할 학생을 하나 이상 선택하세요.");
        return;
      }
      const { created, attributed } = await createDiscoveredStudents(projectId, picks);
      setFeedback(`학생 ${created}명 추가 · 제출물 ${attributed}건 귀속되었습니다.`);
      emitWorksheetRefresh();
      router.refresh();
      reload();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-4 border-black bg-white p-5 shadow-neo-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-md font-black uppercase text-black">
          학생 명단 검토 ({rows.length})
        </h3>
        <button
          type="button"
          onClick={reload}
          disabled={loading || busy}
          className="border-2 border-black bg-white px-3 py-1 text-xs font-bold shadow-neo-sm transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none disabled:opacity-40 cursor-pointer"
        >
          다시 읽기
        </button>
      </div>

      <p className="text-xs font-bold text-black/70">
        업로드된 파일에서 찾은, <b>명단에 없는</b> 학생 후보입니다. 선택한 학생만 명단에
        추가되고 해당 제출물이 자동으로 귀속됩니다 (AI가 임의로 학생을 만들지 않습니다).
      </p>

      {error && (
        <p className="border-2 border-black bg-red-100 px-3 py-2 text-xs font-bold text-red-700 shadow-neo-sm">
          {error}
        </p>
      )}
      {feedback && (
        <p className="border-2 border-black bg-[#C8E6C9] px-3 py-2 text-xs font-bold text-black shadow-neo-sm">
          ✅ {feedback}
        </p>
      )}

      {loading ? (
        <p className="text-sm font-bold text-black/60">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="border-4 border-dashed border-black bg-white px-6 py-6 text-center text-sm font-bold text-black/50">
          발견된 신규 학생 없음
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-4 border-black text-left">
                  <th className="w-10 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() =>
                        setSelected(allChecked ? new Set() : new Set(rows.map(rowKey)))
                      }
                      className="h-5 w-5 border-4 border-black accent-black cursor-pointer"
                      aria-label="전체 선택"
                    />
                  </th>
                  <th className="py-2 font-black uppercase">학번</th>
                  <th className="py-2 font-black uppercase">이름</th>
                  <th className="py-2 font-black uppercase">제출물</th>
                  <th className="py-2 font-black uppercase">출처</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = rowKey(row);
                  const chosen = nameChoice[key] ?? row.name ?? "";
                  return (
                    <tr key={key} className="border-b-2 border-black/20 align-top">
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(key)}
                          className="h-5 w-5 border-4 border-black accent-black cursor-pointer"
                          aria-label={`${row.no ?? ""} ${row.name ?? ""} 선택`}
                        />
                      </td>
                      <td className="py-2 font-bold text-black">{row.no ?? "—"}</td>
                      <td className="py-2 font-bold text-black">
                        {row.conflict.length >= 2 ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-black text-red-700">
                              이름 충돌 — 하나를 고르세요
                            </span>
                            {row.conflict.map((n) => (
                              <label key={n} className="flex items-center gap-2 text-xs font-bold">
                                <input
                                  type="radio"
                                  name={`name-${key}`}
                                  checked={chosen === n}
                                  onChange={() =>
                                    setNameChoice((prev) => ({ ...prev, [key]: n }))
                                  }
                                  className="h-4 w-4 border-2 border-black accent-black cursor-pointer"
                                />
                                {n}
                              </label>
                            ))}
                          </div>
                        ) : (
                          (row.name ?? <span className="text-black/40">학번 {row.no}</span>)
                        )}
                      </td>
                      <td className="py-2 font-bold text-black/70">
                        {row.submissionIds.length}건
                      </td>
                      <td className="py-2">
                        <span className="flex flex-wrap gap-1">
                          {row.sources.map((s) => (
                            <span
                              key={s}
                              className="border-2 border-black bg-neo-muted px-2 py-0.5 text-xs font-black text-black"
                            >
                              {SOURCE_LABEL[s]}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t-4 border-black pt-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="border-4 border-black bg-neo-accent px-5 py-2.5 text-sm font-black uppercase tracking-wide text-white shadow-neo-md transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:opacity-60 cursor-pointer"
            >
              {busy ? "추가 중…" : `선택 학생을 명단에 추가하고 재매칭 (${selected.size})`}
            </button>
            <span className="text-xs font-bold text-black/70">
              학번이 정확히 같거나 이름이 유일하게 일치하는 제출물만 자동 귀속됩니다. 애매한
              건은 확인 대기 큐에 남습니다.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
