// lib/parsing 공개 표면 (세션 5, SPEC 1·5절).
// xlsx/csv/docx/pdf 텍스트 추출과 정규화·해시. 스캔 PDF·이미지의 비전 OCR은
// callLLM(purpose='추출')이 필요해 서버 액션(app/projects/[id]/ingest)에서 수행한다.
export { normalizeText, sha256Hex } from "./hash";
export { parseXlsx, parseCsv } from "./spreadsheet";
export { parseDocx, parsePdfText, isLikelyScan, type PdfTextResult } from "./document";
export {
  decideDedup,
  type DedupExisting,
  type DedupDecision,
} from "./dedup";
export type { SourceType, SpreadsheetData, ColumnMapping } from "./types";
// 파일 종류 판정은 클라이언트에서도 쓰므로 server-only 아닌 kind.ts에 둔다.
export { fileKind, type FileKind } from "./kind";
