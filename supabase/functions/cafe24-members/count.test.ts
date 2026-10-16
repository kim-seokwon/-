import { assertEquals, assertThrows, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { explain, kstDate, parseCount } from "./count.ts";

Deno.test("kstDate: UTC 15:00 이후는 KST 다음날", () => {
  assertEquals(kstDate(new Date("2026-10-16T14:59:00Z")), "2026-10-16");
  assertEquals(kstDate(new Date("2026-10-16T15:00:00Z")), "2026-10-17");
});
Deno.test("parseCount: 숫자·문자 숫자 허용, 이상값 거부", () => {
  assertEquals(parseCount({ count: 6539 }), 6539);
  assertEquals(parseCount({ count: "12" }), 12);
  assertThrows(() => parseCount({}));
  assertThrows(() => parseCount({ count: -1 }));
  assertThrows(() => parseCount({ count: 1.5 }));
});
Deno.test("explain: 403 은 재인증 안내", () => {
  assertMatch(explain("cafe24 /api/v2/admin/customersprivacy/count → 403: insufficient_scope"), /mall\.read_privacy/);
  assertEquals(explain("boom"), "boom");
});
