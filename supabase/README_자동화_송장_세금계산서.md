# 브하스(2179) 자동화 설계 — 송장 자동발번 + 세금계산서 자동발행

> 작성 2026-07-14. 방식 확정 완료. 코드 착수는 각 대행 **가입(API키 발급)** 후.
> 원칙: 대행사에 **락인되지 않게 provider 추상화** (channel_orders를 "채널 무관"으로 짠 것과 동일 패턴).

---

## 1. 송장 자동발번 (굿스플로)

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

### 신규로 만들어야 할 것 (현재 브하스에 B2B 거래 데이터 없음)
- main.js의 '세금계산서'는 문서분류 라벨일 뿐, 발행기능 아님. 거래처/매출 테이블 없음.
- **거래처(business_partners)** 저장: 사업자등록번호·상호·대표자·주소·업태/종목·이메일. (재사용 → 반복 거래처 원클릭)
- **세금계산서 발행 화면**(가벼운 버전): 거래처 선택/입력 + 품목·공급가액 + 발행 버튼. 무거운 매출관리 모듈은 20~30건엔 오버.
- **신규** `supabase/functions/taxinvoice-issue/index.ts` — 팝빌 발행 호출. provider 추상화(추후 바로빌/더존 교체 가능).

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
