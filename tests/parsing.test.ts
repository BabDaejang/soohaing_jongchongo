import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  normalizeText,
  sha256Hex,
  parseCsv,
  parseXlsx,
  parsePdfText,
  isLikelyScan,
  decideDedup,
} from "@/lib/parsing";

// 최소 유효 PDF(1페이지, 텍스트 없음 = 스캔 판정 대상)를 바이트로 생성.
function minimalPdf(): Uint8Array {
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objs) { offsets.push(pdf.length); pdf += o; }
  const xrefStart = pdf.length;
  pdf += "xref\n0 4\n0000000000 65535 f \n";
  for (const off of offsets) pdf += off.toString().padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

test("normalizeText는 공백·줄바꿈 차이를 흡수한다", () => {
  assert.equal(normalizeText("가  나\r\n다  "), normalizeText("가 나\n다"));
});

test("sha256Hex는 결정적이며 정규화 후 동일 내용은 같은 해시 (수용 2)", () => {
  const h1 = sha256Hex(normalizeText("답안  내용\r\n둘째 줄"));
  const h2 = sha256Hex(normalizeText("답안 내용\n둘째 줄"));
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, sha256Hex(normalizeText("다른 내용")));
});

test("parseCsv는 첫 행을 헤더로, 나머지를 행으로 분리한다", () => {
  const { headers, rows } = parseCsv(
    "학번,이름,내용\n10101,홍길동,안녕\n10102,김철수,반가워",
  );
  assert.deepEqual(headers, ["학번", "이름", "내용"]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["10101", "홍길동", "안녕"]);
});

test("parseXlsx 왕복: 작성한 시트를 다시 읽어 헤더·행 복원", () => {
  const aoa = [
    ["학번", "이름", "내용"],
    ["10101", "홍길동", "답안A"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const { headers, rows } = parseXlsx(new Uint8Array(buf));
  assert.deepEqual(headers, ["학번", "이름", "내용"]);
  assert.deepEqual(rows[0], ["10101", "홍길동", "답안A"]);
});

test("parsePdfText는 입력 bytes를 detach하지 않는다 (스캔 PDF OCR base64 보존, 리팩토링 2 배치 1)", async () => {
  const bytes = minimalPdf();
  const lenBefore = bytes.length;
  const { text, pages } = await parsePdfText(bytes);
  // ① detach 안 됨: 호출 후에도 bytes가 그대로여야 OCR 경로가 base64를 인코딩할 수 있다.
  assert.equal(bytes.length, lenBefore);
  assert.ok(bytes.length > 0);
  // ② 1페이지 파싱
  assert.equal(pages, 1);
  // ③ 텍스트 레이어가 비어 스캔본으로 판정된다.
  assert.equal(isLikelyScan(text, pages), true);
});

test("decideDedup: 신규 insert / 동일 skip / 변경 update_pending (수용 2)", () => {
  assert.deepEqual(decideDedup(null, "h1"), { action: "insert" });
  assert.deepEqual(decideDedup({ id: "s1", content_hash: "h1" }, "h1"), {
    action: "skip",
    id: "s1",
  });
  assert.deepEqual(decideDedup({ id: "s1", content_hash: "h1" }, "h2"), {
    action: "update_pending",
    id: "s1",
  });
});
