import "server-only";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { SpreadsheetData } from "./types";

// 2차원 문자열 배열 → {headers, rows}. 첫 행을 헤더로 본다.
function toSpreadsheet(aoa: unknown[][]): SpreadsheetData {
  const grid = aoa.map((row) =>
    (row ?? []).map((cell) => (cell == null ? "" : String(cell).trim())),
  );
  // 완전히 빈 행 제거
  const nonEmpty = grid.filter((row) => row.some((c) => c !== ""));
  const headers = nonEmpty[0] ?? [];
  const rows = nonEmpty.slice(1);
  return { headers, rows };
}

// xlsx: 첫 시트의 셀을 문자열로 읽는다(raw:false → 날짜·숫자도 표시 문자열).
export function parseXlsx(bytes: Uint8Array): SpreadsheetData {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });
  return toSpreadsheet(aoa);
}

// csv: papaparse로 2차원 배열 파싱(헤더 옵션 없이 원시 행).
export function parseCsv(text: string): SpreadsheetData {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return toSpreadsheet(res.data);
}
