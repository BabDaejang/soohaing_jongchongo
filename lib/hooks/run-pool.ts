// 순수 스케줄링 엔진 — React 비의존 (리팩토링 3 배치 1).
// useSequentialRun 훅이 이 모듈을 감싸서 React 상태와 연결한다.
// stepOne 실행기·플래그 리더를 주입받아 테스트 가능.

import type { TermLevel } from "./use-sequential-run";

// ── 공용 타입 (훅에서도 재사용) ──

export type SequentialTarget = { id: string; label: string };

export type StepResult = { ok: boolean; message: string; retryable?: boolean };

export type RunOutcome = {
  succeeded: number;
  failed: number;
  aborted: boolean;
};

export type PrepareResult = {
  targets: SequentialTarget[];
  prelude?: { level: TermLevel; text: string }[];
};

export type RunPlan = {
  prepare: () => Promise<PrepareResult>;
  stepOne: (t: SequentialTarget) => Promise<StepResult>;
  finalize: (r: RunOutcome) => Promise<string | null>;
  nextStage?: (r: RunOutcome) => RunPlan | null;
};

// ── 풀 콜백 ──

export type PoolCallbacks = {
  stepOne: (t: SequentialTarget) => Promise<StepResult>;
  isPaused: () => boolean;
  isStopped: () => boolean;
  onProgress: (done: number, total: number) => void;
  onLog: (level: TermLevel, text: string) => void;
};

export type PoolConfig = {
  concurrency: number; // 1~3 (호출부가 클램프)
  maxConsecutiveFailures: number;
  maxRetries: number; // retryable 백오프 재시도 횟수 (기본 2)
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 재시도 백오프 테이블 (2초 → 6초)
const RETRY_DELAYS = [2000, 6000];

/**
 * 슬라이딩 풀로 targets를 실행한다.
 * concurrency=1이면 기존 직렬과 동일한 관측 가능 동작을 보장한다.
 */
export async function runPool(
  targets: SequentialTarget[],
  cb: PoolCallbacks,
  config: PoolConfig,
): Promise<RunOutcome> {
  let succeeded = 0;
  let failed = 0;
  let consecutive = 0;
  let aborted = false;
  let doneCount = 0;

  const { concurrency, maxConsecutiveFailures, maxRetries } = config;

  // ── 직렬 경로 (concurrency === 1): 기존 동작과 완전히 동일 ──
  if (concurrency <= 1) {
    for (let i = 0; i < targets.length; i++) {
      // 일시정지: 대기
      while (cb.isPaused() && !cb.isStopped()) {
        await sleep(250);
      }
      // 긴급중단
      if (cb.isStopped()) {
        aborted = true;
        break;
      }

      const t = targets[i];
      const result = await executeWithRetry(t, cb, maxRetries);

      if (result.ok) {
        succeeded += 1;
        consecutive = 0;
      } else {
        failed += 1;
        consecutive += 1;
      }

      doneCount += 1;
      cb.onProgress(doneCount, targets.length);

      // 서킷 브레이커
      if (consecutive >= maxConsecutiveFailures) {
        aborted = true;
        cb.onLog("system", `연속 실패 ${maxConsecutiveFailures}건 — 자동 중단`);
        break;
      }
    }
    return { succeeded, failed, aborted };
  }

  // ── 병렬 경로 (concurrency >= 2): 슬라이딩 풀 ──
  let nextIdx = 0; // 다음에 투입할 대상 인덱스

  // in-flight 작업들을 추적한다.
  type InFlightEntry = {
    target: SequentialTarget;
    promise: Promise<{ target: SequentialTarget; result: StepResult }>;
  };
  const inFlight: InFlightEntry[] = [];

  // 새 대상을 풀에 투입한다.
  const enqueue = () => {
    while (
      inFlight.length < concurrency &&
      nextIdx < targets.length &&
      !aborted &&
      !cb.isStopped()
    ) {
      // 일시정지 중이면 새 투입을 멈춘다 (진행 중 건은 계속).
      if (cb.isPaused()) break;

      const t = targets[nextIdx++];
      const promise = executeWithRetry(t, cb, maxRetries).then((result) => ({
        target: t,
        result,
      }));
      inFlight.push({ target: t, promise });
    }
  };

  // 초기 투입
  enqueue();

  while (inFlight.length > 0) {
    // in-flight 중 하나가 끝날 때까지 대기
    const settled = await Promise.race(
      inFlight.map((e) => e.promise),
    );

    // 끝난 항목을 in-flight에서 제거
    const idx = inFlight.findIndex(
      (e) => e.target.id === settled.target.id,
    );
    if (idx !== -1) inFlight.splice(idx, 1);

    // 결과 처리
    if (settled.result.ok) {
      succeeded += 1;
      consecutive = 0;
    } else {
      failed += 1;
      consecutive += 1;
    }

    doneCount += 1;
    cb.onProgress(doneCount, targets.length);

    // 서킷 브레이커
    if (consecutive >= maxConsecutiveFailures) {
      aborted = true;
      cb.onLog("system", `연속 실패 ${maxConsecutiveFailures}건 — 자동 중단`);
      // in-flight 정산: 남은 건들의 완료를 기다린다 (강제 취소 없음).
      if (inFlight.length > 0) {
        const remaining = await Promise.all(
          inFlight.map((e) => e.promise),
        );
        for (const r of remaining) {
          if (r.result.ok) succeeded += 1;
          else failed += 1;
          doneCount += 1;
          cb.onProgress(doneCount, targets.length);
        }
      }
      break;
    }

    // stop 체크
    if (cb.isStopped()) {
      aborted = true;
      // in-flight 정산
      if (inFlight.length > 0) {
        const remaining = await Promise.all(
          inFlight.map((e) => e.promise),
        );
        for (const r of remaining) {
          if (r.result.ok) succeeded += 1;
          else failed += 1;
          doneCount += 1;
          cb.onProgress(doneCount, targets.length);
        }
      }
      break;
    }

    // 일시정지 대기 (신규 투입 안 함, 진행 중 건은 이미 끝남)
    while (cb.isPaused() && !cb.isStopped() && inFlight.length === 0) {
      await sleep(250);
    }

    // 새 대상 투입
    enqueue();
  }

  return { succeeded, failed, aborted };
}

/**
 * 단일 대상을 실행하고, retryable이면 백오프 재시도한다.
 * 재시도 로그와 건별 소요 시간을 출력한다.
 */
async function executeWithRetry(
  t: SequentialTarget,
  cb: PoolCallbacks,
  maxRetries: number,
): Promise<StepResult> {
  const startTime = Date.now();
  let lastResult: StepResult;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 재시도 전 stop 확인
      if (cb.isStopped()) {
        return lastResult!;
      }
      const delay = RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
      cb.onLog("system", `재시도 ${attempt}/${maxRetries} — ${lastResult!.message}`);
      await sleep(delay);
      // 재시도 sleep 후에도 stop 확인
      if (cb.isStopped()) {
        return lastResult!;
      }
    }

    try {
      lastResult = await cb.stepOne(t);
    } catch (e) {
      lastResult = {
        ok: false,
        message: e instanceof Error ? e.message : "처리 중 오류",
      };
    }

    // 성공이거나 retryable이 아니면 즉시 반환
    if (lastResult.ok || !lastResult.retryable || attempt === maxRetries) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      cb.onLog(
        lastResult.ok ? "ok" : "error",
        `${t.label} — ${lastResult.message} (${elapsed}초)`,
      );
      return lastResult;
    }
  }

  // 도달 불가이나 타입 안전용
  return lastResult!;
}

/**
 * RunPlan 체인을 따라가며 다단 스테이지를 실행한다.
 * 연쇄 상한 maxStages(기본 5)를 초과하면 경고 후 중단.
 */
export async function runPlanChain(
  plans: RunPlan[],
  poolConfig: PoolConfig,
  callbacks: {
    isPaused: () => boolean;
    isStopped: () => boolean;
    onProgress: (done: number, total: number) => void;
    onLog: (level: TermLevel, text: string) => void;
    onStageChange?: (current: RunPlan, next: RunPlan | null) => void;
  },
  maxStages: number = 5,
): Promise<{ aborted: boolean; lastPlan?: RunPlan; nextPlan?: RunPlan }> {
  let stageCount = 0;

  for (let planIdx = 0; planIdx < plans.length; planIdx++) {
    let currentPlan: RunPlan | null = plans[planIdx];

    while (currentPlan) {
      stageCount += 1;
      if (stageCount > maxStages) {
        callbacks.onLog("system", `연쇄 상한 ${maxStages}스테이지 초과 — 중단`);
        return { aborted: true, lastPlan: currentPlan };
      }

      if (stageCount > 1) {
        callbacks.onLog("system", "── 다음 단계 ──");
      }

      // prepare
      let prep: PrepareResult;
      try {
        prep = await currentPlan.prepare();
      } catch (e) {
        callbacks.onLog(
          "error",
          e instanceof Error ? e.message : "준비 중 오류가 발생했습니다.",
        );
        const nextStageFn = currentPlan.nextStage;
        const next = nextStageFn ? nextStageFn({ succeeded: 0, failed: 0, aborted: true }) : null;
        return { aborted: true, lastPlan: currentPlan, nextPlan: next || undefined };
      }

      for (const p of prep.prelude ?? []) callbacks.onLog(p.level, p.text);
      callbacks.onProgress(0, prep.targets.length);

      // 풀 실행
      const stepOneFn = currentPlan.stepOne;
      const outcome = await runPool(prep.targets, {
        stepOne: stepOneFn,
        isPaused: callbacks.isPaused,
        isStopped: callbacks.isStopped,
        onProgress: callbacks.onProgress,
        onLog: callbacks.onLog,
      }, poolConfig);

      // finalize
      try {
        const msg = await currentPlan.finalize(outcome);
        if (msg) callbacks.onLog("system", msg);
      } catch (e) {
        callbacks.onLog(
          "error",
          e instanceof Error ? e.message : "마무리 중 오류가 발생했습니다.",
        );
        const nextStageFn = currentPlan.nextStage;
        const next = nextStageFn ? nextStageFn(outcome) : null;
        return { aborted: true, lastPlan: currentPlan, nextPlan: next || undefined };
      }

      // 다음 스테이지 연쇄
      const nextStageFn: ((r: RunOutcome) => RunPlan | null) | undefined = currentPlan.nextStage;
      const nextPlan: RunPlan | null = nextStageFn ? nextStageFn(outcome) : null;

      if (callbacks.onStageChange) {
        callbacks.onStageChange(currentPlan, nextPlan);
      }

      if (outcome.aborted) {
        return { aborted: true, lastPlan: currentPlan, nextPlan: nextPlan || undefined };
      }

      currentPlan = nextPlan;
    }
  }

  return { aborted: false };
}
