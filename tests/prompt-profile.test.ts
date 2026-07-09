import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeProfileLayers } from "@/lib/records/profile";
import type { ProfileItem } from "@/lib/supabase/types";

const account = {
  guidelines: [{ id: "a1", text: "g-a1" }] as ProfileItem[],
  prohibitions: [{ id: "ap1", text: "p-a1" }] as ProfileItem[],
};
const override = {
  guidelines: [{ id: "o1", text: "g-o1" }] as ProfileItem[],
  prohibitions: [] as ProfileItem[],
};

test("계층 적용 순서: 계정 기본 → 프로젝트 오버라이드(우선, 뒤)", () => {
  const merged = mergeProfileLayers(account, override);
  assert.equal(merged.guidelines.length, 2);
  assert.deepEqual(
    merged.guidelines.map((g) => [g.id, g.source]),
    [
      ["a1", "account"],
      ["o1", "project"],
    ],
  );
  // 오버라이드가 없는 금지사항은 계정 기본만
  assert.equal(merged.prohibitions.length, 1);
  assert.equal(merged.prohibitions[0].source, "account");
});

test("오버라이드 없음 → 계정 기본만 태그", () => {
  const merged = mergeProfileLayers(account, null);
  assert.deepEqual(
    merged.guidelines.map((g) => g.source),
    ["account"],
  );
});

test("계정 기본 없음 → 프로젝트 오버라이드만 태그", () => {
  const merged = mergeProfileLayers(null, override);
  assert.deepEqual(
    merged.guidelines.map((g) => g.source),
    ["project"],
  );
  assert.equal(merged.prohibitions.length, 0);
});
