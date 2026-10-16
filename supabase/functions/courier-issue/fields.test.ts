import { assertEquals } from "jsr:@std/assert@1";
import { checkOrder, orderFields, plain } from "./fields.ts";
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
