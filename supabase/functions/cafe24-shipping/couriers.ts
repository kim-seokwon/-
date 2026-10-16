// 카페24 shipping_company_code. 10-15 하이헤이호 GET /api/v2/admin/carriers 로 확인한 값:
//   0012 = 우체국택배, 0001 = 자체배송 (몰에 등록된 배송업체는 이 둘뿐)
// 우체국 외 택배사 코드는 확인 안 됐다 — 쓰기 전에 /carriers 로 다시 볼 것.
export const COURIER_CODE: Record<string, string> = {
  "우체국": "0012", "우체국택배": "0012",
};

export const courierCodeOf = (name?: string, code?: string): string | undefined =>
  code || (name ? COURIER_CODE[name] : undefined);
