# 키디키디(E·LAND) 주문 수집 봇

카페24처럼 공식 API가 없는 채널을 위한 **로그인 봇**. E·LAND 파트너오피스 내부 JSON API를 세션쿠키로 호출해 주문을 Supabase에 저장한다. 서버 없이 **GitHub Actions 크론**으로 매시간 자동 실행.

## 동작
1. Playwright로 로그인 (ID/PW → **TOTP 6자리 자체생성**, otplib)
2. 세션쿠키로 주문 API 호출:
   `GET /o/order/lookup/orders?fromSearchDate=..&toSearchDate=..&orderCodes=..&size=200`
3. `channel_orders` 테이블에 upsert (channel=`eland`, mall_key=`kidikidi`)

## 필요한 값 (GitHub 리포 Settings → Secrets and variables → Actions)
| Secret | 설명 |
|---|---|
| `ELAND_ID` / `ELAND_PW` | 파트너오피스 로그인 |
| `ELAND_TOTP_SECRET` | OTP **재등록** 화면의 "설정 키"(base32). 봇이 이걸로 6자리 생성. 폰 인증기에도 같은 키 등록 가능. |
| `SUPABASE_URL` | `https://czaykmmwzlcisozmbxpl.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase service_role 키 (서버용) |

## 마무리 상태 (2026-07 확정)
- [x] 로그인 셀렉터 확정 — `#userId` / `#pwd` / `a#login` → TOTP `#otp_num` / `a#otp_certify` (실 DOM 확인)
- [x] 주문 API URL 확정 — `d=on` + `ordMediaKcodes`/`cancelCodes`/`takebackCodes`/`exchangeCodes` 전체 파라미터 필요(누락 시 503). `sync.mjs`의 `orderUrl()`
- [x] 응답 envelope `{resultCode, resultMessage, ...}` 처리 + `extractList()` 방어적 추출
- [ ] **TOTP 설정 키 확보** ← 유일한 실행 블로커. 로그인 화면 "OTP 신규재등록(문자/이메일)"로 재등록 → 나오는 base32 "설정 키"를 `ELAND_TOTP_SECRET`(GitHub Secret)에 저장 (기존 인증기 무효화됨)
- [ ] 첫 실주문 1건으로 성공 응답의 배열 key + 필드명 확정 → `mapOrder()` 미세조정 (지금은 방어적 추측)
- [ ] 송장 등록 API 캡처 (주문배송관리 > 배송관리) → 송장 push 추가 (주문 수집엔 불필요)

## 로컬 테스트
```
cd channel-bots/kidikidi
npm install && npx playwright install chromium
ELAND_ID=.. ELAND_PW=.. ELAND_TOTP_SECRET=.. SUPABASE_URL=.. SUPABASE_SERVICE_KEY=.. npm run sync
```

> 무신사·29CM(통합 파트너)용 봇은 이 구조를 복제하되 2차 인증만 Gmail API로 이메일 코드 읽기로 교체.
