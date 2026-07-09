// 상대평가 등급 파생 (SPEC 6절). **순수 함수** — 서버 재계산 배치와 클라이언트 등급제 토글이
// 동일 함수를 사용해, 등급제(5/9) 즉시 전환이 재계산 없이 배치 결과와 완전히 일치한다.
// INV-6: 등급은 저장된 점수(effective_score)에서 **파생 계산만** 한다 (직접 저장·수정 없음).
import type { GradingScheme, TieBreak } from "@/lib/supabase/types";

// 누적 비율(%) 경계 (SPEC 6절). boundaries[g]까지 누적하면 등급 g+1.
//   5등급  = 누적 10 / 34 / 66 / 90 / 100
//   9등급  = 누적 4 / 11 / 23 / 40 / 60 / 77 / 89 / 96 / 100 (스테나인)
export const GRADE_BOUNDARIES: Record<GradingScheme, number[]> = {
  grade5: [10, 34, 66, 90, 100],
  grade9: [4, 11, 23, 40, 60, 77, 89, 96, 100],
};

// 부동소수 경계(예: 34.00000001) 흡수용 미세 오차.
const EPS = 1e-9;

// 백분위 석차(1..N)를 누적 비율 경계에 매핑해 등급(1-based)을 반환한다.
export function deriveGrade(
  percentileRank: number,
  total: number,
  scheme: GradingScheme,
): number {
  const boundaries = GRADE_BOUNDARIES[scheme];
  if (total <= 0) return 1;
  const pct = (percentileRank / total) * 100;
  for (let g = 0; g < boundaries.length; g++) {
    if (pct <= boundaries[g] + EPS) return g + 1;
  }
  return boundaries.length; // 안전장치 — 마지막 등급
}

export type Standing = { rank: number; grade: number };

// effective_score 배열을 받아 각 원소의 석차(rank)·등급(grade)을 계산한다(입력 순서 보존).
// - 내림차순 정렬. 동점군은 경쟁 석차(그룹 최상위 위치)를 rank로 부여한다.
// - 등급 파생 백분위: best_grade = 최상위 석차 p(유리), mid_rank = 중간석차 p+(k-1)/2 (NEIS 관행).
export function computeStandings(
  scores: number[],
  scheme: GradingScheme,
  tieBreak: TieBreak,
): Standing[] {
  const n = scores.length;
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const result: Standing[] = new Array(n);

  let i = 0;
  while (i < n) {
    const p = i + 1; // 1-based 그룹 최상위 위치
    let j = i;
    while (j + 1 < n && scores[order[j + 1]] === scores[order[i]]) j++;
    const k = j - i + 1; // 동점군 크기
    const percentileRank = tieBreak === "mid_rank" ? p + (k - 1) / 2 : p;
    const grade = deriveGrade(percentileRank, n, scheme);
    for (let t = i; t <= j; t++) {
      result[order[t]] = { rank: p, grade };
    }
    i = j + 1;
  }
  return result;
}
