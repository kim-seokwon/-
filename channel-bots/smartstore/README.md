# 스마트스토어(네이버 커머스) 주문 수집 봇

**공식 API 사용 — 로그인 봇·OTP 불필요.** 네이버 커머스API 애플리케이션의 client_id/secret으로 전자서명 토큰을 받아 주문을 조회, Supabase `channel_orders`에 저장한다. GitHub Actions 크론으로 자동 실행.

## 동작
1. `client_secret`(bcrypt salt)로 `{client_id}_{timestamp}` 서명 → `POST /v1/oauth2/token` → access_token(2h)
2. `GET /v1/pay-order/seller/product-orders/last-changed-statuses?lastChangedFrom=` → 최근 변경 주문 ID
3. `POST /v1/pay-order/seller/product-orders/query` → 상세 → `channel_orders` upsert (channel=`naver`, mall_key=`smartstore`)

## 필요한 값 (GitHub Secrets)
| Secret | 설명 |
|---|---|
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | [커머스API센터](https://apicenter.commerce.naver.com) → 애플리케이션 등록 후 발급 |
| `SUPABASE_URL` | `https://czaykmmwzlcisozmbxpl.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service_role 키 |

## 준비 (한 번만)
1. 커머스API센터에서 애플리케이션 생성 → **주문 조회** 권한(스코프) 부여
2. 발급된 client_id/secret을 GitHub Secrets에 등록
3. 끝 — 이후 무인 자동 (재로그인/OTP 없음)

> 스마트스토어는 카페24 다음으로 자동화가 가장 깔끔한 채널(공식 API). 키디키디/무신사 같은 세션 봇의 불안정성이 없다.
