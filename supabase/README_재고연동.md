# BHAS 재고 + 카페24 연동 — 설치 가이드

> 브하스를 **재고 마스터**로 두고 카페24와 양방향 동기화. 29CM·키디키디는 공개 API가 없어 제외(브하스에서 수동 차감 → 단일 재고풀 유지). 데이터모델은 채널 무관 설계라 추후 통합솔루션(사방넷 등) 경유 확장 가능.

## 1. DB 스키마 설치 (Supabase Dashboard → SQL Editor)

순서대로 실행:
1. `migrations/001_inventory.sql` — 재고 테이블 + 원장 트리거 + RLS
2. `migrations/002_workspace.sql` — 노션식 페이지/보드 테이블
3. `migrations/004_orders.sql` — 주문통합(OMS) 테이블
4. (Edge Function 배포 후) `migrations/003_cafe24_cron.sql` — 10분 주기 동기화

> `supabase_rls_setup.sql`의 헬퍼함수(`get_user_role` 등)가 먼저 설치돼 있어야 합니다.

## 2. 카페24 앱 발급

1. https://developers.cafe24.com → 앱 생성
2. **Client ID / Secret** 발급
3. 권한(Scope): `mall.read_product, mall.write_product, mall.read_order, mall.read_store`
4. **Redirect URL** = `https://<PROJECT_REF>.supabase.co/functions/v1/cafe24-oauth` (정확히 일치)

## 3. Edge Function 배포 (Supabase CLI)

```bash
supabase functions deploy cafe24-oauth    --no-verify-jwt
supabase functions deploy cafe24-sync      --no-verify-jwt
supabase functions deploy cafe24-shipping  --no-verify-jwt

# 시크릿 등록 (프론트엔드에 절대 노출 금지)
supabase secrets set \
  CAFE24_MALL_ID=<몰아이디> \
  CAFE24_CLIENT_ID=<client_id> \
  CAFE24_CLIENT_SECRET=<client_secret> \
  CAFE24_REDIRECT_URI=https://<PROJECT_REF>.supabase.co/functions/v1/cafe24-oauth
```
> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 는 Edge Function 런타임에 기본 제공됩니다.

## 4. 인증 (토큰 발급)

브라우저로 접속 → 카페24 로그인/동의 → 토큰 자동 저장:
```
https://<PROJECT_REF>.supabase.co/functions/v1/cafe24-oauth
```
완료 화면이 뜨면 `channel_sync_state`에 토큰이 저장된 것.

## 5. 검증 (⚠️ 실판매몰 — 반드시 단계적으로)

기본값 `channel_sync_state.dry_run = TRUE` → **push는 로그만, 실몰 무변경**.

1. 브하스 → **재고 관리** → 품목 추가 → **매핑** 버튼으로 카페24 `product_no`/`variant_code` 입력
2. `cafe24-sync` 수동 1회 호출:
   ```bash
   curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/cafe24-sync \
     -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
   ```
3. 응답 JSON의 `would_push` + `sync_log` 테이블에서 "보낼 예정 수량" 확인 (실몰 변화 없음)
4. **단일 테스트상품 1개**만 매핑한 상태에서 `dry_run=false`로 전환:
   ```sql
   UPDATE channel_sync_state SET dry_run = false WHERE channel = 'cafe24';
   ```
5. 브하스에서 수량 변경 → sync → 카페24 반영 확인 → 카페24서 1건 주문 → 다음 sync에 브하스 차감 확인(이중카운트 없음)
6. 정상 확인되면 `migrations/003_cafe24_cron.sql`로 자동 스케줄 등록

## 6. 주문/배송(OMS) 사용법

브하스 → **주문/배송** 메뉴:
1. **카페24 주문 수집** 버튼(또는 10분 cron) → 신규 주문이 한 페이지로 모임 (재고도 자동 차감)
2. **송장양식 다운로드** → 배송대상 주문이 CSV로 (받는분·주소·상품·수량). 택배사 프로그램에 넣어 운송장 출력
3. 운송장번호 받은 파일을 **송장번호 업로드** (CSV 헤더: `주문번호,택배사,송장번호`)
   → `cafe24-shipping`이 카페24에 **배송중+운송장** 일괄 등록 → 주문 상태가 '배송중'으로

> 택배사 API 계약 불필요(엑셀 다리 방식). `dry_run=true`면 카페24 전송 없이 브하스 상태만 갱신되어 흐름을 안전하게 미리 볼 수 있음.
> 29CM·키디키디 주문은 API가 없어 자동 수집 안 됨 → 재고는 '재고 관리'에서 수동 조정으로 반영.

## 동작 요약

```
브하스 재고(원장 합계 = on_hand)  ── push ──▶  카페24 inventory
        ▲                                          │
        └──────────── 차감(주문 pull) ◀────────────┘
  29CM·키디키디 판매 → 브하스에서 '수동' 조정으로 차감
```

- 현재고 = `inventory_ledger` delta 합계 (트리거가 `inventory_items.on_hand` 캐시 갱신)
- 카페24 주문은 `reason='cafe24_order'`, `ref=주문번호:품목코드`로 멱등 차감
- 토큰: access ~2h 자동 refresh, refresh ~2주 (만료 시 4번 재실행)
