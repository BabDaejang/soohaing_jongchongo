import { test } from "node:test";
import assert from "node:assert/strict";
import { isPurgeEligible } from "@/lib/retention";

const now = new Date("2026-07-20T00:00:00Z");
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

test("미승인(extraction_approved_at=null)이면 언제나 삭제 불가 — INV-5 (수용 3)", () => {
  assert.equal(isPurgeEligible(null, 7, now), false);
  assert.equal(isPurgeEligible(null, 30, now), false);
});

test("자동 삭제 정책 꺼짐(retentionDays=null)이면 삭제 불가", () => {
  assert.equal(isPurgeEligible(daysAgo(365), null, now), false);
});

test("승인됐고 N일 경과 → 삭제 자격", () => {
  assert.equal(isPurgeEligible(daysAgo(8), 7, now), true);
  assert.equal(isPurgeEligible(daysAgo(31), 30, now), true);
});

test("승인됐지만 아직 N일 미경과 → 삭제 불가", () => {
  assert.equal(isPurgeEligible(daysAgo(3), 7, now), false);
  assert.equal(isPurgeEligible(daysAgo(10), 30, now), false);
});

test("경계: 정확히 N일 경과는 자격 있음", () => {
  assert.equal(isPurgeEligible(daysAgo(7), 7, now), true);
});
