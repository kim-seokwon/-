# 무신사 · 29CM 주문 수집 봇

무신사가 29CM를 인수 → **통합 파트너센터** 하나로 로그인. 공식 오픈API가 없어 로그인 봇 방식. 2차인증이 **이메일 OTP**라 봇이 Gmail API로 인증번호를 자동으로 읽는다(사람 개입 없음).

## 동작
1. Playwright로 통합 SSO 로그인(`partner-sso.one.musinsa.com/oauth`, ID/PW)
2. 이메일 OTP 화면 → **Gmail API로 최근 인증메일의 6자리 자동 추출** → 입력
3. 파트너센터 내부 API로 주문 조회 → `channel_orders` 저장 (channel=`musinsa`, mall_key=`musinsa`|`29cm`)

## 필요한 값 (GitHub Secrets)
| Secret | 설명 |
|---|---|
| `MUSINSA_ID` / `MUSINSA_PW` | 통합 파트너 로그인 |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | OTP 메일 읽기용 OAuth (읽기 전용 scope) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Supabase |

## ⚠️ 마무리에 필요한 것 (캡처 세션 — 키디키디와 동일 절차)
- [ ] 통합 SSO 로그인 폼 셀렉터 + 이메일 OTP 입력 셀렉터 확정
- [ ] **주문 조회 내부 API 캡처** (파트너센터 주문 페이지 네트워크 로그) → `fetchOrders()` 구현
- [ ] 응답 필드명 → `mapOrder()` 조정 + 무신사/29CM 구분 필드
- [ ] Gmail 읽기용 OAuth refresh_token 발급

> 키디키디는 로그인해서 네트워크 로그로 주문 API를 확정했다(30분이면 됨). 무신사도 로그인 세션 한 번이면 동일하게 확정 가능.
