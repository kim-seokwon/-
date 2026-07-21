# 브하스(2179) 자동화 설계 — 송장 자동발번 + 세금계산서 자동발행

> 작성 2026-07-14. 방식 확정 완료. 코드 착수는 각 대행 **가입(API키 발급)** 후.
> 원칙: 대행사에 **락인되지 않게 provider 추상화** (channel_orders를 "채널 무관"으로 짠 것과 동일 패턴).

---

## 1-A. 송장 최종 결정 (2026-07-21): 우체국 계약소포 OpenAPI 직접 ★채택
아래 굿스플로 검토(1)는 참고로 남김. **실제 채택 = 우체국 오픈API 직접.** 이유: 멀티채널(카페24 API·무신사 API·키디키디 엑셀)을 브하스가 이미 통합하는데, 굿스플로는 무신사·키디키디 커버 못 하고 API는 엔터프라이즈(세팅 22만+월협의)만 됨. 우체국 계약택배 계약은 이미 보유 → 오픈API 직접이 전채널·대행료0.

- **base URL:** `http://ship.epost.go.kr/{메시지명}` — REST GET/POST, 결과 XML, **UTF-8**
- **인증:** `key`=인증키(regkey, 오픈API사용신청>소포신청으로 발급, **30자리, 비밀=서버에만**) + 쓰기API는 `regData`=SEED128 암호문
- **암호화:** SEED-128 대칭키 **ECB**, 키=접수용 **보안키**(신청결과 화면 [보안키생성]). 평문 `custNo=..&reqType=1&officeSer=01&weight=5&..`(& 구분) → SEED128 → regData. Java/PHP 샘플 → **Deno 포팅 필요**. 참조: `supabase/functions/_epost_ref/` (SEED128.java/.php, 규격서 PDF).
- **API 목록(ship.epost.go.kr):** 고객번호조회 `api.GetCustNo.jparcel` → 계약승인번호 `api.GetApprNo.jparcel` → **공급지등록 `api.InsertOffice.jparcel`** → **발번(소포신청/픽업) `api.InsertOrder.jparcel`**(등기번호 리턴) → 확인 `api.GetResInfo.jparcel` / 취소 `api.GetResCancelCmd.jparcel`. 배송조회=종추적 API(같은 regkey).
- **헤더:** Connection: keep-alive, Host: biz.epost.go.kr, User-Agent 지정(방화벽).
- **빌드 계획:** ① SEED128 Deno 포팅 ② Edge Function `courier-issue`(고객번호→승인번호→공급지등록1회→InsertOrder 발번→등기번호 저장) ③ brhas OMS 배송탭에서 채널주문 골라 일괄 발번+각 채널 배송중 처리 ④ regkey/보안키는 `provider_credentials`(service_role 전용)에.
- **상태:** regkey 발급 완료(서버 설정에 넣을 것). **남은 것: 접수용 보안키 [보안키생성] + 위 빌드.**

## 1. 송장 자동발번 (굿스플로) — 참고(미채택)

### 왜 굿스플로인가
- 우체국 계약(이미 보유)은 **그대로 유지**, 발번만 대행. 굿스플로에 우체국 **고객번호=업체코드** 등록.
- 우체국 **기업간연계(EDI)는 제외**: 항상 켜진 "연계서버"가 필요 → Supabase 서버리스 브하스에 부적합. (대행료 0이지만 서버/규격/유지보수 부담)
- 우체국 공개 openapi.epost = **조회만**, 발번 불가.
- 굿스플로에 서버용 OPEN API(REST) 존재 확인(api.goodsflow.io / test-api.goodsflow.io) → 윈도우 gfPlayer 없이 서버 발번 가능.
- 요금: 자동송장 현재 무료(베타). 유료 전환돼도 월 1~3만원대(2019 고도몰 기준) 푼돈. 락인은 추상화로 방지.

### 데이터 흐름 (목표 = 무인화)
```
카페24 주문 → [cafe24-sync, 기존] channel_orders 저장 + 재고차감(이미 자동)
           → [courier-issue, 신규] 굿스플로에 송장번호 발급 요청 → 송장번호 수신
           → channel_orders.invoice_no / courier 저장
           → [cafe24-shipping, 기존] 카페24에 배송중+송장 write-back (이미 있음)
```
→ 이미 있는 조각(sync·shipping)에 **가운데 "발번" 한 조각만** 끼우면 완성.

### 붙일 지점 (기존 코드 재사용)
- `supabase/functions/cafe24-sync/index.ts` — 주문수집·재고차감 (그대로)
- `supabase/functions/cafe24-shipping/index.ts` — 배송중 write-back (그대로, 송장번호만 넣어주면 됨)
- **신규** `supabase/functions/courier-issue/index.ts` — provider 인터페이스 + 굿스플로 구현
- **신규** provider 추상화: `issueWaybill(order) → { courier, invoice_no }`. 오늘은 goodsflow 구현, 나중에 스윗트래커/우체국직접으로 교체 가능.

### 블록된 것 (= 사용자 가입 대기)
- 굿스플로 raw REST 규격(엔드포인트·인증·요청/응답 필드) = **가입 후 개발자포털에서 확보**.
- 물리 라벨 인쇄 방식(API가 PDF/URL 주는지, gfPlayer 필요한지) = 가입 후 확인.

---

## 2. 세금계산서 자동발행 (팝빌)

### 범위
- **B2B만** (제작 컨설팅·도매 등 사업자 상대). 월 **20~30건**. "직원이 못해서" 자동화 → 어드민에서 거래처 고르고 금액만 넣으면 발행.
- B2C 쇼핑몰 주문은 세금계산서 아님(현금영수증 영역) → 이번 범위 제외.

### 왜 팝빌
- 홈택스 직접연동(공인인증서·전자서명)은 무겁고 위험 → 제외.
- 팝빌 = REST API로 발행→국세청 자동신고. **종량제**(선불포인트, 건당 차감, 월정액 X). 사업자번호로 연동회원 가입.

### 데이터 소스 = 최종견적서 (2026-07-16 결정, "A")
세금계산서 내용을 수기입력 안 하고 **브하스 제작 단계의 견적에서 매칭**해서 자동 채움. 기존 STAGES에 딱 맞음:
```
상담 → 계약(견적) → 원단 → 패턴 → 봉제 → 디테일 → 세금계산서 → 출고
        contract_estimate                        tax_invoice    shipping_info
```
- **계약/견적 단계(contract_estimate)** = 거래처·품목·공급가액 소스
- **출고 단계(shipping_info)** = 공급일(납품일) 소스 → **세금계산서 작성일자**. 이걸로 월/과세기간이 자동 확정 → 오늘(07-14) 같은 월 섞임·날짜 실수 원천봉쇄.
- **세금계산서 단계(tax_invoice)** = "이 견적으로 발행" 버튼 → 팝빌.

### 신규로 만들어야 할 것
- **현 상태**: 계약/견적 단계가 "문서"로만 있고 거래처·금액이 숫자 데이터 아님. main.js '세금계산서'도 문서분류 라벨.
- **계약 단계에 구조화된 견적 입력** 추가: 거래처(사업자등록번호·상호·대표자·주소·업태/종목·이메일) + 품목 + 공급가액. → business_partners/거래(견적) 테이블.
- **세금계산서 단계에 "이 견적으로 발행" 버튼**: 견적 데이터 + 출고일 → 팝빌 발행 → 결과(문서관리번호) 저장. 무거운 매출관리 모듈은 20~30건엔 오버 → 견적 기반이면 이걸로 충분.
- **신규** `supabase/functions/taxinvoice-issue/index.ts` — 팝빌 발행 호출. provider 추상화(추후 바로빌/더존 교체 가능).

### 자동발급 엔진이 반드시 강제할 규칙 (2026-07-14 실제 수기발급 사고에서 도출)
실제로 수기발급하다 아래 실수로 지연가산세 ~6.7만원 + 월 섞임 위험 발생. 엔진은 이걸 구조적으로 차단해야 함.
1. **작성일자 = 공급일(납품일) 기준. 결제일 아님.** (결제 7/9여도 6월 납품이면 6월분) — 예외: 선수금/선발행 시 받은 날.
2. **월합계는 같은 달 거래만 합침. 월 넘김 절대 금지.** 5월·6월·7월 거래를 한 장에 못 섞음.
3. **부가세 과세기간 자동 귀속**: 1기=1~6월, 2기=7~12월. 5·6월은 같은 1기(같은 장에 묶여도 세액 영향 없음), 7월은 2기(반드시 분리). ← 7월을 6월에 넣으면 과세기간 오류 = 수정발급 사고.
4. **발급기한 = 공급월의 다음 달 10일.** 그 전에 자동발급. D-3 알림.
5. **지연 경고**: 발급기한 경과분은 확정신고기한(1기 7/25 / 2기 다음해 1/25) 전에 발급하면 지연 1%, 넘기면 미발급 2%. 엔진이 "7/25 전 발급" 데드라인 관리.
6. 실측 예: `[5/29 2,754,500]+[6/12 4,414,000]+[6/22 220,000]` → **6월/1기 1장**(합 7,388,500) OK. `[7/9 2,035,000]` → **7월/2기 별도 1장**. 금액은 VAT포함 → 공급가액=금액/1.1.

### 블록된 것
- 팝빌 연동회원 가입(사업자번호) + LinkID/SecretKey = 사용자 가입 후.

---

## 3. 다음 관문 (사용자 작업 — 키/사업자정보 입력은 사용자만, 가드레일)
1. **굿스플로 가입** (goodsflow.io) → 우체국 고객번호를 업체코드에 등록 → 우체국 승인 1~2일 → API키 발급
2. **팝빌 연동회원 가입** (popbill.com) → 사업자번호 → LinkID/SecretKey 발급

키 확보되면: courier-issue(송장) 먼저 → taxinvoice(세금계산서) 순으로 착수. 둘은 독립적.

## 4. 제안 스키마 (가입 후 실행, 지금은 초안)
```sql
-- 대행 자격증명 (service_role 전용, RLS deny). 굿스플로/팝빌 키 보관.
CREATE TABLE IF NOT EXISTS provider_credentials (
  provider   TEXT PRIMARY KEY,        -- 'goodsflow' | 'popbill'
  config     JSONB NOT NULL DEFAULT '{}',  -- api_key, secret, 우체국고객번호, 발송지 등
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- channel_orders 에 이미 courier/invoice_no 있음 → 발번 결과 그대로 저장.

-- 세금계산서용
CREATE TABLE IF NOT EXISTS business_partners (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_no       TEXT NOT NULL,          -- 사업자등록번호
  corp_name    TEXT NOT NULL,          -- 상호
  ceo_name     TEXT,
  address      TEXT,
  biz_type     TEXT,                   -- 업태
  biz_item     TEXT,                   -- 종목
  email        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tax_invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    UUID REFERENCES business_partners(id),
  supply_amount BIGINT NOT NULL,       -- 공급가액
  tax_amount    BIGINT NOT NULL,       -- 세액
  items         JSONB DEFAULT '[]',
  issue_date    DATE,
  popbill_mgtkey TEXT,                 -- 팝빌 문서관리번호
  status        TEXT DEFAULT 'draft',  -- draft|issued|failed
  created_at    TIMESTAMPTZ DEFAULT now()
);
```
