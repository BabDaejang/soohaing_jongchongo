import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spreadsheetToText,
  extractTextFromExampleFile,
} from "@/lib/records/example-file";

const enc = new TextEncoder();

test("spreadsheetToText: 헤더+행을 탭 구분 평문으로, 빈 셀·빈 행 제거", () => {
  const text = spreadsheetToText({
    headers: ["이름", "", "생기부"],
    rows: [
      ["김가", "", "탐구를 수행함."],
      ["", "", ""],
      ["이나", "x", "발표를 주도함."],
    ],
  });
  assert.equal(
    text,
    "이름\t생기부\n김가\t탐구를 수행함.\n이나\tx\t발표를 주도함.",
  );
});

test("txt/md: UTF-8 디코드 그대로", async () => {
  const out = await extractTextFromExampleFile(
    "예시.txt",
    enc.encode("동기가 뚜렷함.\n결과를 얻음."),
  );
  assert.equal(out, "동기가 뚜렷함.\n결과를 얻음.");
  const md = await extractTextFromExampleFile("예시.MD", enc.encode("# 제목"));
  assert.equal(md, "# 제목"); // 확장자 대소문자 무관
});

test("csv: 스프레드시트 평탄화 경로", async () => {
  const out = await extractTextFromExampleFile(
    "sample.csv",
    enc.encode("이름,생기부\n김가,탐구를 수행함."),
  );
  assert.equal(out, "이름\t생기부\n김가\t탐구를 수행함.");
});

test("hwp: 명시적 안내 에러", async () => {
  await assert.rejects(
    () => extractTextFromExampleFile("생기부.hwp", enc.encode("x")),
    /한글\(hwp\)/,
  );
});

test("미지원 확장자·빈 파일 에러", async () => {
  await assert.rejects(
    () => extractTextFromExampleFile("사진.png", enc.encode("x")),
    /지원하지 않는 파일 형식/,
  );
  await assert.rejects(
    () => extractTextFromExampleFile("빈파일.txt", new Uint8Array()),
    /빈 파일/,
  );
});
