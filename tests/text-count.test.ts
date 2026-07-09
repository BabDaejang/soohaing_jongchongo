import { test } from "node:test";
import assert from "node:assert/strict";
import { countText } from "@/lib/text-count";

test("chars: 공백 포함 코드 포인트 수", () => {
  assert.equal(countText("가나다", "chars"), 3);
  assert.equal(countText("ab 라", "chars"), 4); // a,b,공백,라
  assert.equal(countText("", "chars"), 0);
});

test("bytes: UTF-8 바이트(한글 3바이트)", () => {
  assert.equal(countText("가나다", "bytes"), 9); // 3자 × 3바이트
  assert.equal(countText("ab 라", "bytes"), 6); // 1+1+1+3
  assert.equal(countText("A", "bytes"), 1);
});
