import "server-only";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

// docx: mammoth로 서식 없는 원문 텍스트 추출.
export async function parseDocx(bytes: Uint8Array): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value;
}

export type PdfTextResult = { text: string; pages: number };

// pdf: 텍스트 레이어 추출(서버리스 pdfjs = unpdf, canvas 불필요).
export async function parsePdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  // pdf.js(getDocumentProxy)는 전달받은 ArrayBuffer를 워커로 이전(detach)한다.
  // 호출자가 bytes를 계속 쓸 수 있도록(스캔 PDF OCR의 base64 인코딩 등) 사본을 넘긴다.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return {
    text: Array.isArray(text) ? text.join("\n\n") : text,
    pages: totalPages,
  };
}

// 페이지당 실제 문자 수가 임계값 미만이면 스캔본으로 판정 → 비전 OCR 경로로 보낸다.
export function isLikelyScan(text: string, pages: number): boolean {
  const charCount = text.replace(/\s/g, "").length;
  const denom = pages > 0 ? pages : 1;
  return charCount / denom < 20;
}
