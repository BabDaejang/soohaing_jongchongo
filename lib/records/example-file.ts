import "server-only";
// 예시 생기부 파일 → 분석용 텍스트 추출 (세션 8a 확장, 사용자 지시 2026-07-10).
// 세션 5의 lib/parsing 파서를 재사용한다 — 새 파싱 라이브러리 금지.
// 지원: txt/md(플레인), docx(mammoth), pdf 텍스트 레이어(unpdf), xlsx/csv(SheetJS·papaparse).
// 미지원: hwp(스택 밖 — pdf/docx 변환 안내), 스캔 PDF(OCR 비용 — 붙여넣기 안내), 이미지.
import {
  parseCsv,
  parseDocx,
  parsePdfText,
  parseXlsx,
  isLikelyScan,
  type SpreadsheetData,
} from "@/lib/parsing";

// 분석 입력 상한(buildExampleAnalysisMessages가 8000자로 자르지만, 액션 응답 크기도 제한).
export const EXAMPLE_TEXT_MAX = 20000;
export const EXAMPLE_FILE_MAX_BYTES = 8 * 1024 * 1024; // next.config serverActions bodySizeLimit(10mb)보다 여유 있게

// 스프레드시트를 분석용 평문으로 평탄화한다. **순수** — 셀을 행 단위 탭 구분으로 잇는다.
// (생기부 예시가 행별로 든 시트 전제 — 헤더 포함, 빈 셀 제거)
export function spreadsheetToText(data: SpreadsheetData): string {
  const lines: string[] = [];
  if (data.headers.some((h) => h !== "")) {
    lines.push(data.headers.filter((h) => h !== "").join("\t"));
  }
  for (const row of data.rows) {
    const cells = row.filter((c) => c !== "");
    if (cells.length > 0) lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

function extOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

// 파일 이름·바이트 → 텍스트. 실패는 교사에게 보여줄 한국어 메시지로 throw.
export async function extractTextFromExampleFile(
  filename: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.length === 0) throw new Error("빈 파일입니다.");
  if (bytes.length > EXAMPLE_FILE_MAX_BYTES) {
    throw new Error("파일이 너무 큽니다(8MB 이하만 지원).");
  }

  const ext = extOf(filename);
  let text: string;
  switch (ext) {
    case "txt":
    case "md":
      text = new TextDecoder("utf-8").decode(bytes);
      break;
    case "docx":
      text = await parseDocx(bytes);
      break;
    case "pdf": {
      const { text: pdfText, pages } = await parsePdfText(bytes);
      if (isLikelyScan(pdfText, pages)) {
        throw new Error(
          "스캔본 PDF로 보입니다. 예시 분석은 텍스트 PDF만 지원합니다 — 내용을 복사해 붙여넣어 주세요.",
        );
      }
      text = pdfText;
      break;
    }
    case "xlsx":
      text = spreadsheetToText(parseXlsx(bytes));
      break;
    case "csv":
      text = spreadsheetToText(parseCsv(new TextDecoder("utf-8").decode(bytes)));
      break;
    case "hwp":
    case "hwpx":
      throw new Error(
        "한글(hwp) 파일은 지원하지 않습니다. 한글에서 PDF 또는 docx로 저장해 업로드해 주세요.",
      );
    default:
      throw new Error(
        `지원하지 않는 파일 형식입니다(.${ext || "?"}). txt·md·docx·pdf·xlsx·csv만 가능합니다.`,
      );
  }

  const clean = text.trim();
  if (!clean) throw new Error("파일에서 텍스트를 추출하지 못했습니다.");
  return clean.slice(0, EXAMPLE_TEXT_MAX);
}
