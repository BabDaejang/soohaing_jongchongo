import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  normalizeText,
  sha256Hex,
  parseCsv,
  parseXlsx,
  decideDedup,
} from "@/lib/parsing";

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
