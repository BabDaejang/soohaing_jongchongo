import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPool, runPlanChain, type PoolCallbacks, type PoolConfig, type RunPlan, type SequentialTarget } from "../lib/hooks/run-pool";

// ── 헬퍼 ──

function makeTargets(n: number): SequentialTarget[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    label: `대상${i}`,
  }));
}

function makeCallbacks(overrides: Partial<PoolCallbacks> = {}): PoolCallbacks & {
  logs: { level: string; text: string }[];
  progressHistory: { done: number; total: number }[];
} {
  const logs: { level: string; text: string }[] = [];
  const progressHistory: { done: number; total: number }[] = [];
  return {
    stepOne: async (t) => ({ ok: true, message: `ok:${t.id}` }),
    isPaused: () => false,
    isStopped: () => false,
    onProgress: (done, total) => progressHistory.push({ done, total }),
    onLog: (level, text) => logs.push({ level, text }),
    logs,
    progressHistory,
    ...overrides,
  };
}

const defaultConfig: PoolConfig = {
  concurrency: 1,
  maxConsecutiveFailures: 3,
  maxRetries: 2,
};

// ── 테스트 ──

describe("runPool — 동시성 1 (직렬)", () => {
  it("1. 직렬과 동일한 순서로 실행된다", async () => {
    const order: string[] = [];
    const cb = makeCallbacks({
      stepOne: async (t) => {
        order.push(t.id);
        return { ok: true, message: `done:${t.id}` };
      },
    });
    const result = await runPool(makeTargets(5), cb, { ...defaultConfig, concurrency: 1 });
    assert.deepStrictEqual(order, ["t0", "t1", "t2", "t3", "t4"]);
    assert.equal(result.succeeded, 5);
    assert.equal(result.failed, 0);
    assert.equal(result.aborted, false);
  });
});

describe("runPool — 동시성 2~3", () => {
  it("2. 동시성 2에서 최대 in-flight 2 준수", async () => {
    let maxInFlight = 0;
    let currentInFlight = 0;
    const cb = makeCallbacks({
      stepOne: async (t) => {
        currentInFlight += 1;
        if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
        // 비동기 지연으로 병렬 동작 확인
        await new Promise((r) => setTimeout(r, 10));
        currentInFlight -= 1;
        return { ok: true, message: `ok:${t.id}` };
      },
    });
    await runPool(makeTargets(6), cb, { ...defaultConfig, concurrency: 2 });
    assert.ok(maxInFlight <= 2, `maxInFlight=${maxInFlight}, 2 이하여야`);
    assert.ok(maxInFlight >= 2, `maxInFlight=${maxInFlight}, 병렬이 실행되어야`);
  });

  it("3. 동시성 3에서 최대 in-flight 3 준수", async () => {
    let maxInFlight = 0;
    let currentInFlight = 0;
    const cb = makeCallbacks({
      stepOne: async (t) => {
        currentInFlight += 1;
        if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
        await new Promise((r) => setTimeout(r, 10));
        currentInFlight -= 1;
        return { ok: true, message: `ok:${t.id}` };
      },
    });
    await runPool(makeTargets(9), cb, { ...defaultConfig, concurrency: 3 });
    assert.ok(maxInFlight <= 3, `maxInFlight=${maxInFlight}, 3 이하여야`);
    assert.ok(maxInFlight >= 2, `maxInFlight=${maxInFlight}, 병렬이 실행되어야`);
  });
});

describe("runPool — pause/stop", () => {
  it("4. pause 후 신규 미투입·재개 후 이어가기", async () => {
    let count = 0;
    let paused = false;
    const cb = makeCallbacks({
      stepOne: async (t) => {
        count += 1;
        if (count === 2) {
          paused = true;
          // 250ms 후 resume
          setTimeout(() => { paused = false; }, 300);
        }
        return { ok: true, message: `ok:${t.id}` };
      },
      isPaused: () => paused,
    });
    const result = await runPool(makeTargets(4), cb, { ...defaultConfig, concurrency: 1 });
    assert.equal(result.succeeded, 4);
    assert.equal(result.aborted, false);
  });

  it("5. stop 시 in-flight 정산 후 aborted", async () => {
    let count = 0;
    let stopped = false;
    const cb = makeCallbacks({
      stepOne: async (t) => {
        count += 1;
        if (count === 2) stopped = true;
        return { ok: true, message: `ok:${t.id}` };
      },
      isStopped: () => stopped,
    });
    const result = await runPool(makeTargets(10), cb, { ...defaultConfig, concurrency: 1 });
    assert.equal(result.aborted, true);
    // 2건째에서 stop → 2건 succeeded (stop은 "다음 스텝 직전 루프 종료")
    assert.ok(result.succeeded <= 3, `succeeded=${result.succeeded}`);
    assert.ok(result.succeeded >= 2, `succeeded=${result.succeeded}`);
  });

  it("5b. 동시성 2 + stop 시 in-flight 정산 후 aborted", async () => {
    let count = 0;
    let stopped = false;
    const cb = makeCallbacks({
      stepOne: async (t) => {
        count += 1;
        await new Promise((r) => setTimeout(r, 5));
        if (count >= 3) stopped = true;
        return { ok: true, message: `ok:${t.id}` };
      },
      isStopped: () => stopped,
    });
    const result = await runPool(makeTargets(10), cb, { ...defaultConfig, concurrency: 2 });
    assert.equal(result.aborted, true);
    // in-flight 정산 후 성공분 반영
    assert.ok(result.succeeded >= 2, `succeeded=${result.succeeded}`);
  });
});

describe("runPool — 서킷 브레이커", () => {
  it("6. 연속 실패 3회 서킷 브레이커 (완료 순서 기준)", async () => {
    const cb = makeCallbacks({
      stepOne: async () => ({ ok: false, message: "fail" }),
    });
    const result = await runPool(makeTargets(10), cb, {
      ...defaultConfig,
      concurrency: 1,
      maxConsecutiveFailures: 3,
    });
    assert.equal(result.aborted, true);
    assert.equal(result.failed, 3);
    assert.ok(
      cb.logs.some((l) => l.text.includes("연속 실패")),
      "서킷 브레이커 로그가 있어야 함",
    );
  });

  it("7. 성공이 연속 실패 카운터를 리셋", async () => {
    let callCount = 0;
    const cb = makeCallbacks({
      stepOne: async () => {
        callCount += 1;
        // 패턴: 실패 2, 성공 1, 실패 2, 성공 1, ...
        if (callCount % 3 === 0) return { ok: true, message: "ok" };
        return { ok: false, message: "fail" };
      },
    });
    const result = await runPool(makeTargets(12), cb, {
      ...defaultConfig,
      concurrency: 1,
      maxConsecutiveFailures: 3,
    });
    // 실패 2→성공 1 패턴이므로 연속 3회 도달 없이 전건 처리
    assert.equal(result.aborted, false);
    assert.equal(result.succeeded + result.failed, 12);
  });
});

describe("runPool — retryable 재시도", () => {
  it("8. retryable 재시도 2회 후 최종 실패만 집계", async () => {
    let attempts = 0;
    const cb = makeCallbacks({
      stepOne: async () => {
        attempts += 1;
        return { ok: false, message: "rate limit", retryable: true };
      },
    });
    const result = await runPool(makeTargets(1), cb, {
      ...defaultConfig,
      concurrency: 1,
      maxConsecutiveFailures: 10, // 서킷 안 터지게
    });
    // 1회 원본 + 2회 재시도 = 3회 시도
    assert.equal(attempts, 3);
    assert.equal(result.failed, 1);
    assert.equal(result.succeeded, 0);
    // 재시도 로그 확인
    assert.ok(
      cb.logs.some((l) => l.text.includes("재시도 1/2")),
      "재시도 1/2 로그가 있어야 함",
    );
    assert.ok(
      cb.logs.some((l) => l.text.includes("재시도 2/2")),
      "재시도 2/2 로그가 있어야 함",
    );
  });

  it("9. retryable 성공 시 failed 미집계", async () => {
    let attempts = 0;
    const cb = makeCallbacks({
      stepOne: async () => {
        attempts += 1;
        if (attempts < 3) return { ok: false, message: "429", retryable: true };
        return { ok: true, message: "success" };
      },
    });
    const result = await runPool(makeTargets(1), cb, {
      ...defaultConfig,
      concurrency: 1,
    });
    assert.equal(attempts, 3); // 2회 실패 후 3회째 성공
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);
  });
});

describe("runPool — 건별 소요 시간", () => {
  it("결과 라인에 (n.n초) 접미가 있다", async () => {
    const cb = makeCallbacks({
      stepOne: async (t) => {
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true, message: `done:${t.id}` };
      },
    });
    await runPool(makeTargets(1), cb, { ...defaultConfig, concurrency: 1 });
    assert.ok(cb.logs.length >= 1);
    const log = cb.logs.find((l) => l.level === "ok");
    assert.ok(log, "ok 로그가 있어야 함");
    assert.match(log.text, /\(\d+\.\d초\)/, "소요 시간 접미가 있어야 함");
  });
});

describe("runPlanChain — 다단 연쇄", () => {
  it("10. 2회 연쇄(3스테이지) 진행·progress 리셋", async () => {
    const stageOrder: string[] = [];
    const progressResets: number[] = [];

    const makePlan = (name: string, next?: string): RunPlan => ({
      prepare: async () => {
        stageOrder.push(`prepare:${name}`);
        return { targets: makeTargets(2) };
      },
      stepOne: async (t) => {
        stageOrder.push(`step:${name}:${t.id}`);
        return { ok: true, message: "ok" };
      },
      finalize: async (_r) => {
        stageOrder.push(`finalize:${name}`);
        return null;
      },
      nextStage: next
        ? () => makePlan(next, name === "A" ? "C" : undefined)
        : undefined,
    });

    const logs: { level: string; text: string }[] = [];
    const result = await runPlanChain(
      [makePlan("A", "B")],
      { ...defaultConfig, concurrency: 1 },
      {
        isPaused: () => false,
        isStopped: () => false,
        onProgress: (done, total) => {
          if (done === 0) progressResets.push(total);
        },
        onLog: (level, text) => logs.push({ level, text }),
      },
      5,
    );

    assert.equal(result.aborted, false);
    // 3스테이지 실행 확인
    assert.ok(stageOrder.includes("prepare:A"));
    assert.ok(stageOrder.includes("finalize:A"));
    assert.ok(stageOrder.includes("prepare:B"));
    assert.ok(stageOrder.includes("finalize:B"));
    assert.ok(stageOrder.includes("prepare:C"));
    assert.ok(stageOrder.includes("finalize:C"));
    // "── 다음 단계 ──" 로그 2회
    const nextLogs = logs.filter((l) => l.text.includes("다음 단계"));
    assert.equal(nextLogs.length, 2);
    // progress 리셋 3회 (스테이지마다)
    assert.equal(progressResets.length, 3);
  });

  it("11. 연쇄 상한 5스테이지 캡", async () => {
    // 무한 연쇄하는 plan
    const makePlan = (): RunPlan => ({
      prepare: async () => ({ targets: [{ id: "x", label: "x" }] }),
      stepOne: async () => ({ ok: true, message: "ok" }),
      finalize: async () => null,
      nextStage: () => makePlan(),
    });

    const logs: { level: string; text: string }[] = [];
    const result = await runPlanChain(
      [makePlan()],
      { ...defaultConfig, concurrency: 1 },
      {
        isPaused: () => false,
        isStopped: () => false,
        onProgress: () => {},
        onLog: (level, text) => logs.push({ level, text }),
      },
      5,
    );

    assert.equal(result.aborted, true);
    assert.ok(
      logs.some((l) => l.text.includes("연쇄 상한")),
      "연쇄 상한 경고 로그가 있어야 함",
    );
  });
});

describe("runPool — 동시성 2 서킷 브레이커", () => {
  it("6b. 동시성 2에서 서킷 브레이커 + in-flight 정산", async () => {
    const cb = makeCallbacks({
      stepOne: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { ok: false, message: "fail" };
      },
    });
    const result = await runPool(makeTargets(10), cb, {
      ...defaultConfig,
      concurrency: 2,
      maxConsecutiveFailures: 3,
    });
    assert.equal(result.aborted, true);
    // 서킷 발동(3) + in-flight 정산(최대 1) = 3~4
    assert.ok(result.failed >= 3, `failed=${result.failed}`);
    assert.ok(result.failed <= 5, `failed=${result.failed}`);
  });
});
