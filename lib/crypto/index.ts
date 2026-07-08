import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM 대칭 암복호화 — API 키 저장용 (INV-4, SPEC 3절).
// 키는 환경변수 APP_ENCRYPTION_KEY (base64 인코딩된 32바이트).
// 이 모듈은 'server-only' — 클라이언트 번들에 유입되면 빌드가 실패한다.

const IV_LENGTH = 12; // GCM 권장 nonce 길이
const TAG_LENGTH = 16;

// 키는 함수 호출 시점에 읽는다(모듈 로드 시점 아님) — 테스트·서버리스 환경 편의.
function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY는 base64 인코딩된 32바이트여야 합니다 (현재 ${key.length}바이트).`,
    );
  }
  return key;
}

// 평문 → base64(iv | tag | ciphertext). 매 호출 IV를 새로 생성한다.
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

// base64(iv | tag | ciphertext) → 평문. 변조 시 GCM 인증 실패로 throw.
export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("암호문 형식이 올바르지 않습니다.");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

// 마스킹 표시용 끝 4자리. 4자 미만이면 있는 만큼.
export function keyLast4(plaintext: string): string {
  return plaintext.slice(-4);
}
