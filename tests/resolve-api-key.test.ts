import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiKey, type ApiKeyRow } from "@/lib/llm/keys";

// 복호화는 항등 함수로 주입해 선택 로직만 검증한다(암복호화는 crypto.test.ts에서 별도 검증).
const decryptFn = (s: string) => `decrypted:${s}`;

test("개인 키가 있으면 기본 키 대신 개인 키를 사용한다 (수용 기준 3)", async () => {
  const rows: ApiKeyRow[] = [
    { owner_id: null, encrypted_key: "DEFAULT" }, // 관리자 기본 키
    { owner_id: "user-1", encrypted_key: "PERSONAL" }, // 개인 키
  ];
  const result = await resolveApiKey("user-1", "prov-1", {
    fetchRows: async () => rows,
    decryptFn,
  });
  assert.equal(result, "decrypted:PERSONAL");
});

test("개인 키가 없으면 기본 키를 사용한다", async () => {
  const rows: ApiKeyRow[] = [{ owner_id: null, encrypted_key: "DEFAULT" }];
  const result = await resolveApiKey("user-1", "prov-1", {
    fetchRows: async () => rows,
    decryptFn,
  });
  assert.equal(result, "decrypted:DEFAULT");
});

test("개인 키·기본 키가 모두 없으면 명시적 에러를 던진다", async () => {
  await assert.rejects(
    resolveApiKey("user-1", "prov-1", {
      fetchRows: async () => [],
      decryptFn,
    }),
    /등록된 API 키가 없습니다/,
  );
});
