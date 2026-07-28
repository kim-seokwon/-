# 채널 봇 활성화 — GitHub Secrets 시트

봇 코드는 배포 완료. 아래 값만 **GitHub 웹**에 넣으면 매시간 자동으로 돈다.
넣는 곳: **리포 → Settings → Secrets and variables → Actions → New repository secret**
(리포: `github.com/kim-seokwon/-`)

## 공통 (모든 봇)
| Secret | 값 |
|---|---|
| `SUPABASE_URL` | `https://czaykmmwzlcisozmbxpl.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase 대시보드 → Project Settings → **API** → `service_role` 키 (secret) 복사 |

## 키디키디 (E·LAND) — `kidikidi-sync.yml`
| Secret | 값 |
|---|---|
| `ELAND_ID` | 파트너오피스 아이디 |
| `ELAND_PW` | 파트너오피스 비밀번호 |
| `ELAND_TOTP_SECRET` | **OTP 재등록 시 문자로 온 "설정 키"**(base32 문자열). 폰 인증기에 넣는 그 값과 동일. |

## 스마트스토어 (네이버 커머스, 공식 API — 봇/OTP 불필요) — `smartstore-sync.yml`
| Secret | 값 |
|---|---|
| `NAVER_CLIENT_ID` | 커머스API센터(apicenter.commerce.naver.com) → 앱 등록 후 발급 |
| `NAVER_CLIENT_SECRET` | 위 앱의 시크릿 |

## 무신사·29CM — `musinsa-29cm-sync.yml`  ※ 주문 API 캡처 세션 후 활성화
| Secret | 값 |
|---|---|
| `MUSINSA_ID` / `MUSINSA_PW` | 통합 파트너 로그인 |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | OTP 메일 읽기용 (읽기전용 scope) |

---
## 활성화 후
- Actions 탭 → 각 워크플로 → **Run workflow**(수동 1회 테스트) → 로그에서 "저장 완료 N건" 확인
- 이후 자동: 키디키디 매시 정각 / 스마트스토어 매시 15분 / 무신사 매시 30분
- 대시보드 매출 → 채널별 매출에 자동 집계됨
