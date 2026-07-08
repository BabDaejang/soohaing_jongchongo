import { createHash } from "node:crypto";

// 정규화: 개행 통일, 연속 공백·빈 줄 축소, 양끝 트림.
// 재업로드 시 공백·줄바꿈만 다른 내용은 같은 해시가 되어 중복으로 건너뛴다(SPEC 5.1).
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 정규화 텍스트의 SHA-256 (hex). content_hash 저장·중복 감지에 사용.
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
