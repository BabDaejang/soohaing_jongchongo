import { test } from "node:test";
import assert from "node:assert/strict";
import { navLinksFor, navRoleFor } from "@/lib/nav";

// 전역 내비게이션 분기 (리팩토링 4 배치 1, P-6).
// GlobalNav 서버 컴포넌트는 이 두 순수 함수의 합성이다 — 분기는 여기서 전수 검증한다.

// ── 수용 1: 비로그인 → 내비 없음 ──────────────────────────────────────────
test("비로그인(profile 없음) → role null, 링크 0개", () => {
  const role = navRoleFor(null);
  assert.equal(role, null);
  assert.deepEqual(navLinksFor(role), []);
});

// ── 수용 2: 미승인(pending·rejected) → 내비 없음 (대기 화면 오염 금지) ────
test("미승인(pending) → role null, 링크 0개", () => {
  const role = navRoleFor({ role: "user", status: "pending" });
  assert.equal(role, null);
  assert.deepEqual(navLinksFor(role), []);
});

test("미승인(rejected)은 admin이어도 링크 0개", () => {
  const role = navRoleFor({ role: "admin", status: "rejected" });
  assert.equal(role, null);
  assert.deepEqual(navLinksFor(role), []);
});

// ── 수용 3: 승인 user → 프로젝트·팩트시트·계정 3링크 ─────────────────────
test("승인 user → 3링크(/, /factsheets, /account), 관리자 없음", () => {
  const links = navLinksFor(navRoleFor({ role: "user", status: "approved" }));
  assert.deepEqual(
    links.map((l) => l.href),
    ["/", "/factsheets", "/account"],
  );
  assert.deepEqual(
    links.map((l) => l.label),
    ["프로젝트", "팩트시트", "계정"],
  );
});

// ── 수용 4: 승인 admin → 관리자 포함 4링크 ──────────────────────────────
test("승인 admin → 4링크(관리자 포함, 마지막)", () => {
  const links = navLinksFor(navRoleFor({ role: "admin", status: "approved" }));
  assert.deepEqual(
    links.map((l) => l.href),
    ["/", "/factsheets", "/account", "/admin"],
  );
  assert.equal(links[3].label, "관리자");
});

// 공용 상수를 노출하므로 호출자가 배열을 변형해도 다음 호출이 오염되지 않아야 한다.
test("반환 배열 변형이 다음 호출에 새지 않는다", () => {
  const first = navLinksFor("user");
  first.push({ href: "/hack", label: "주입" });
  assert.equal(navLinksFor("user").length, 3);
});
