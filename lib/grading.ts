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

// ── 목표 등급 → 보정 점수 구간 (리팩토링 4 배치 4, P-4) ──────────────────
//
// INV-6은 등급의 직접 저장·수정을 금지한다. 그래서 "이 학생을 N등급으로" 같은 입력은 만들지
// 않고, 대신 **그 등급이 나오는 보정 점수 구간**을 계산해 교사가 점수를 넣게 돕는다.
// 등급은 여전히 점수에서 파생될 뿐이며, 이 함수는 아무것도 저장하지 않는다(순수 계산).

// 보정 점수의 정의역 — students.score_override와 같은 0~999 정수(표시 점수 스케일).
const OVERRIDE_MIN = 0;
const OVERRIDE_MAX = 999;

// 후보 점수를 끼워 넣었을 때 그 학생이 받게 될 등급.
// computeStandings는 입력 순서를 보존하므로 마지막 원소가 후보다.
function gradeWithCandidate(
  otherScores: number[],
  candidate: number,
  scheme: GradingScheme,
  tieBreak: TieBreak,
): number {
  const standings = computeStandings([...otherScores, candidate], scheme, tieBreak);
  return standings[standings.length - 1].grade;
}

// 등급은 점수에 대해 **단조**다(점수가 오르면 등급 번호는 같거나 작아진다) — 동점 처리
// 양쪽(best_grade·mid_rank) 모두에서 성립하므로 목표 등급 구간을 이진 탐색으로 찾을 수 있다.
export function overrideRangeForGrade(
  otherScores: number[],
  scheme: GradingScheme,
  tieBreak: TieBreak,
  targetGrade: number,
): { min: number; max: number } | null {
  const gradeCount = GRADE_BOUNDARIES[scheme].length;
  if (!Number.isInteger(targetGrade) || targetGrade < 1 || targetGrade > gradeCount) {
    return null;
  }

  const gradeAt = (c: number) =>
    gradeWithCandidate(otherScores, c, scheme, tieBreak);

  // min = gradeAt(c) <= target을 만족하는 가장 작은 c (술어가 false→true로 단조).
  let lo = OVERRIDE_MIN;
  let hi = OVERRIDE_MAX;
  if (gradeAt(OVERRIDE_MAX) > targetGrade) return null; // 최고점으로도 도달 못 함
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (gradeAt(mid) <= targetGrade) hi = mid;
    else lo = mid + 1;
  }
  const min = lo;

  // max = gradeAt(c) >= target을 만족하는 가장 큰 c (술어가 true→false로 단조).
  lo = OVERRIDE_MIN;
  hi = OVERRIDE_MAX;
  if (gradeAt(OVERRIDE_MIN) < targetGrade) return null; // 최저점으로도 그 등급보다 좋다
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (gradeAt(mid) >= targetGrade) lo = mid;
    else hi = mid - 1;
  }
  const max = lo;

  // 인원·비율상 그 등급이 아예 비는 경우가 있다(예: 소인원에서 중간 등급).
  if (min > max || gradeAt(min) !== targetGrade) return null;
  return { min, max };
}
