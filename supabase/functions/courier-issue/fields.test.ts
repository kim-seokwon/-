import { assertEquals } from "jsr:@std/assert@1";
import { checkOrder, orderFields, plain, REGDATA_MAX, regDataLen } from "./fields.ts";
import { seedEncryptEcbHex } from "./seed128.ts";
import { courierCodeOf } from "../cafe24-shipping/couriers.ts";

const creds = { custNo: "C1", apprNo: "A1", officeSer: "O1" };
const order = {
  orderNo: "20261015-0000001", ordCompNm: "하이헤이호", recNm: "홍길동",
  recZip: "06-234", recAddr1: "서울 강남구 테헤란로 1", recAddr2: "101호",
  recMob: "010-1234-5678", goodsNm: "니트 외 1", qty: 2, weight: 1, volume: 60,
};

Deno.test("의류 내용품코드 025 가 기본값", () => {
  assertEquals(orderFields(order, creds).contCd, "025");
  assertEquals(orderFields({ ...order, contCd: "021" }, creds).contCd, "021");
});

Deno.test("전화·우편번호는 숫자만 보낸다 (08-04 ordTel 오류)", () => {
  const f = orderFields({ ...order, ordTel: "02) 123-4567", inqTelCn: "1588-0000", recTel: "-" }, creds);
  assertEquals(f.recMob, "01012345678");
  assertEquals(f.recZip, "06234");
  assertEquals(f.ordTel, "021234567");
  assertEquals(f.inqTelCn, "15880000");
  assertEquals(f.recTel, undefined); // 숫자가 없으면 아예 안 보낸다
});

Deno.test("평문에는 빈 값이 빠지고 기본값이 들어간다", () => {
  const p = plain(orderFields(order, creds, "Y"));
  assertEquals(p.includes("recTel="), false);
  assertEquals(p.includes("ordTel="), false);
  for (const kv of ["custNo=C1", "apprNo=A1", "officeSer=O1", "contCd=025", "printYn=N", "testYn=Y", "payType=1", "reqType=1", "microYn=N"]) {
    assertEquals(p.includes(kv), true, kv);
  }
});

Deno.test("카페24 우체국택배 코드는 0012 (10-15 /carriers 확인)", () => {
  assertEquals(courierCodeOf("우체국택배"), "0012");
  assertEquals(courierCodeOf("우체국"), "0012");
  assertEquals(courierCodeOf("CJ대한통운"), undefined); // 확인 안 된 코드는 보내지 않는다
  assertEquals(courierCodeOf("우체국택배", "9999"), "9999");
});

Deno.test("값 안의 & = 는 전각으로 바꿔 평문 구분자와 안 겹친다", () => {
  const p = plain(orderFields({ ...order, recAddr2: "A&B빌딩 3층", goodsNm: "니트=2" }, creds));
  assertEquals(p.includes("recAddr2=A＆B빌딩 3층&"), true);
  assertEquals(p.includes("goodsNm=니트＝2&"), true);
  assertEquals(p.split("&").every((kv) => /^[A-Za-z0-9]+=/.test(kv)), true);
});

Deno.test("발송 전 검사: 정상은 통과, 빠짐·길이·범위는 사유로", () => {
  assertEquals(checkOrder(orderFields(order, creds)), []);
  const e = (o: Record<string, unknown>) => checkOrder(orderFields({ ...order, ...o }, creds)).join(" | ");
  assertEquals(/수취인 전화·휴대폰/.test(e({ recMob: "", recTel: "-" })), true);
  assertEquals(/recAddr2 없음/.test(e({ recAddr2: "" })), true);
  assertEquals(/recNm 41자/.test(e({ recNm: "가".repeat(41) })), true);
  assertEquals(/recZip 6자/.test(e({ recZip: "123-456" })), true);
  assertEquals(/goodsNm 401자/.test(e({ goodsNm: "가".repeat(401) })), true);
  assertEquals(/weight 0/.test(e({ weight: 0 })), true);
  assertEquals(/weight 31/.test(e({ weight: 31 })), true);
  assertEquals(/volume 161/.test(e({ volume: 161 })), true);
  assertEquals(e({ weight: 30, volume: 160, recNm: "가".repeat(40) }), "");
});

Deno.test("공백만인 필수값은 없음, 우편번호는 숫자 정확히 5자리", () => {
  const e = (o: Record<string, unknown>) => checkOrder(orderFields({ ...order, ...o }, creds)).join(" | ");
  assertEquals(/recNm 없음/.test(e({ recNm: "   " })), true);
  assertEquals(/recAddr2 없음/.test(e({ recAddr2: " \t" })), true);
  assertEquals(/recZip 4자 — 숫자 5자리만/.test(e({ recZip: "1234" })), true);
  assertEquals(e({ recZip: "12345" }), "");
});

Deno.test("regData 4000자 경계: 실제 암호문 길이 = regDataLen, 4000 통과 · 4032 차단", () => {
  const base = orderFields({ ...order, delivMsg: "" }, creds);
  const room = 2000 - new TextEncoder().encode(plain(base)).length - "&delivMsg=".length;   // 평문 2000바이트 = hex 4000자
  const at = (n: number) => orderFields({ ...order, delivMsg: "a".repeat(n) }, creds);
  // delivMsg 는 200자 한도라 영문만으론 못 채운다 → 한글(3바이트)+영문으로 맞춘다
  const fill = (bytes: number) => { const k = Math.min(66, Math.floor(bytes / 3)); return "가".repeat(k) + "a".repeat(bytes - k * 3); };
  const big = { recAddr2: "나".repeat(300), goodsNm: "다".repeat(Math.floor((room - 900) / 3) - 70) };
  const roomBig = 2000 - new TextEncoder().encode(plain(orderFields({ ...order, ...big }, creds))).length - "&delivMsg=".length;
  const ok = orderFields({ ...order, ...big, delivMsg: fill(roomBig) }, creds);
  const over = orderFields({ ...order, ...big, delivMsg: fill(roomBig) + "a" }, creds);
  assertEquals(new TextEncoder().encode(plain(ok)).length, 2000);
  for (const f of [ok, over, at(0)]) assertEquals(seedEncryptEcbHex("1234567890abcdefghijkl", plain(f)).length, regDataLen(plain(f)));
  assertEquals(regDataLen(plain(ok)), REGDATA_MAX);
  assertEquals(checkOrder(ok), []);
  assertEquals(regDataLen(plain(over)), 4032);
  assertEquals(checkOrder(over), ["전체 4032자(최대 4000) — 주소·상품명·배송메시지를 줄여주세요"]);
  // 코덱스 재현형: 항목별 한도 안(주소 150+300·상품명 400 한글)인데 합치면 초과
  const each = orderFields({ ...order, recAddr1: "가".repeat(150), recAddr2: "나".repeat(300), goodsNm: "다".repeat(400) }, creds);
  assertEquals(checkOrder(each).length, 1);
  assertEquals(/^전체 \d+자\(최대 4000\)/.test(checkOrder(each)[0]), true);
});
