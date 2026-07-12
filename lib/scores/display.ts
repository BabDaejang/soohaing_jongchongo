// 999점 표시 점수 체계 (리팩토링 2 배치 2, SPEC 6절 개정 예정) — **순수 모듈**.
// 루브릭 채점(evaluations)·합성 원점수(composite)는 그대로 산출하되, 화면·상대 조정에 쓰는
// 점수는 여기서 배정하는 "표시 점수"다. 초기 확정 인원 채점 전에는 확정하지 않고(행 미생성),
// 충족 시 원점수 순위로 스프레드, 이후 학생은 이웃 사이 중간값으로 삽입한다.
// 배정값은 재계산에도 유지(sticky) — 교사가 조정한 감각이 흔들리지 않게. 등급·순위는
// effective(= override ?? display)에서 파생(INV-6 불변)하므로 이 모듈은 표시 점수만 다룬다.

export const DISPLAY_MAX = 999;
export const SPREAD_TOP = 800;
export const SPREAD_BOTTOM = 200;
export const MIN_INITIAL_GAP = 15;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// 초기 확정 인원: 채점 대상 15명 미만이면 전원, 아니면 대상의 25%를 15~25명으로 클램프.
export function initialConfirmCount(totalTargets: number): number {
  if (totalTargets < 15) return totalTargets;
  return clamp(Math.round(totalTargets * 0.25), 15, 25);
}

// n명을 SPREAD_TOP→SPREAD_BOTTOM 등간격 내림차순 배치(round 정수). n===1 → [500].
// n ≤ 41이면 간격 ≥ MIN_INITIAL_GAP이 자동 보장된다(600/40=15).
export function spreadScores(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [Math.round((SPREAD_TOP + SPREAD_BOTTOM) / 2)]; // 500
  const step = (SPREAD_TOP - SPREAD_BOTTOM) / (n - 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round(SPREAD_TOP - step * i));
  return out;
}

// 위(above=raw가 더 큰 이웃의 표시 점수)/아래(below=raw가 더 작은 이웃) 사이의 삽입값.
// above 없음(최상위 진입) → round((below + DISPLAY_MAX) / 2),
// below 없음(최하위 진입) → round(above / 2),
// 둘 다 있으면 중간값(min/max 정규화 후). 정수 여유가 없으면(이웃과 겹침) null.
export function insertBetween(
  above: number | null,
  below: number | null,
): number | null {
  let hi: number;
  let lo: number;
  if (above === null && below === null) return null;
  if (above === null) {
    hi = DISPLAY_MAX;
    lo = below as number;
  } else if (below === null) {
    hi = above;
    lo = 0;
  } else {
    hi = Math.max(above, below);
    lo = Math.min(above, below);
  }
  const mid = Math.round((hi + lo) / 2);
  if (mid <= lo || mid >= hi) return null; // 정수 여유 소진
  return mid;
}

export type RawRankedStudent = { studentId: string; raw: number }; // 원점수 내림차순 정렬 입력(동점 허용)
export type AssignResult = {
  displays: Map<string, number>; // 전원 확정 시 rawRanked 전원의 표시 점수. 미확정 국면이면 빈 Map
  confirmed: boolean; // false = 초기 확정 인원 미달(전부 미확정)
  respread: boolean; // true = 공간 소진으로 전체 재배치가 일어남
};

export function assignDisplayScores(input: {
  rawRanked: RawRankedStudent[]; // 호출부가 원점수 내림차순 정렬 보장
  existing: ReadonlyMap<string, number>; // 이전 배정(sticky). rawRanked에 없는 학생은 무시
  totalTargets: number; // 채점 대상 학생 총수(미채점 포함)
}): AssignResult {
  const { rawRanked, existing, totalTargets } = input;

  const rankedIds = new Set(rawRanked.map((r) => r.studentId));
  const rawById = new Map(rawRanked.map((r) => [r.studentId, r.raw]));

  // 1. existing에서 rawRanked에 없는 studentId 제거(탈락자 정리) → kept.
  const kept = new Map<string, number>();
  for (const [id, disp] of existing) {
    if (rankedIds.has(id)) kept.set(id, disp);
  }

  // 초기 스프레드: rawRanked 순서대로 배정하되 원점수 동점 그룹은 그룹 첫 위치 값으로 통일.
  const fullSpread = (): Map<string, number> => {
    const scores = spreadScores(rawRanked.length);
    const out = new Map<string, number>();
    let groupStart = 0;
    for (let i = 0; i < rawRanked.length; i++) {
      if (i > 0 && rawRanked[i].raw !== rawRanked[i - 1].raw) groupStart = i;
      out.set(rawRanked[i].studentId, scores[groupStart]);
    }
    return out;
  };

  // 2. kept가 비어 있고 인원 미달 → 전부 미확정.
  if (kept.size === 0 && rawRanked.length < initialConfirmCount(totalTargets)) {
    return { displays: new Map(), confirmed: false, respread: false };
  }

  // 3. kept가 비어 있고 인원 충족 → 초기 스프레드.
  if (kept.size === 0) {
    return { displays: fullSpread(), confirmed: true, respread: false };
  }

  // 4. kept가 있으면: 기존 유지 + 신규를 raw 내림차순으로 하나씩 삽입.
  const displays = new Map(kept);
  const newcomers = rawRanked.filter((r) => !kept.has(r.studentId));
  for (const nc of newcomers) {
    // anchors = 이미 display를 가진 (raw, display) 집합(기존 + 이번에 배정된 신규 포함).
    let sameRawDisp: number | null = null;
    let aboveDisp: number | null = null; // raw가 더 큰 anchor들의 display 최솟값
    let belowDisp: number | null = null; // raw가 더 작은 anchor들의 display 최댓값
    for (const [id, disp] of displays) {
      const r = rawById.get(id);
      if (r === undefined) continue;
      if (r === nc.raw) {
        sameRawDisp = disp; // 동점 → 같은 display
      } else if (r > nc.raw) {
        aboveDisp = aboveDisp === null ? disp : Math.min(aboveDisp, disp);
      } else {
        belowDisp = belowDisp === null ? disp : Math.max(belowDisp, disp);
      }
    }
    const placed =
      sameRawDisp !== null ? sameRawDisp : insertBetween(aboveDisp, belowDisp);
    if (placed === null) {
      // 정수 소진 → 전량 재배치(kept를 버리고 rawRanked 전체를 3번 규칙으로 재스프레드).
      return { displays: fullSpread(), confirmed: true, respread: true };
    }
    displays.set(nc.studentId, placed);
  }

  return { displays, confirmed: true, respread: false };
}
