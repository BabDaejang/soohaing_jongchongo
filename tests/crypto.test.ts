import { test } from "node:test";
import assert from "node:assert/strict";

// getKey()는 함수 호출 시점에 env를 읽으므로(모듈 로드 시점 아님) 여기서 설정해 두면 충분하다.
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { encrypt, decrypt, keyLast4 } from "@/lib/crypto";

test("encrypt→decrypt 왕복이 원문을 복원한다", () => {
  const plain = "sk-ant-0123456789";
  const enc = encrypt(plain);
  assert.notEqual(enc, plain); // 평문이 그대로 저장되지 않는다
  assert.equal(decrypt(enc), plain);
});

test("매 호출 새 IV를 써서 같은 평문도 다른 암호문이 된다", () => {
  const plain = "same-secret";
  assert.notEqual(encrypt(plain), encrypt(plain));
});

test("변조된 암호문은 GCM 인증 실패로 throw 한다", () => {
  const enc = encrypt("secret");
  const buf = Buffer.from(enc, "base64");
  buf[buf.length - 1] ^= 0xff; // 마지막 바이트 변조
  assert.throws(() => decrypt(buf.toString("base64")));
});

test("keyLast4는 끝 4자리를 반환한다", () => {
  assert.equal(keyLast4("abcdef1234"), "1234");
});
