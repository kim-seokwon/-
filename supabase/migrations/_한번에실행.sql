-- ══════════════════════════════════════════════════════════════
--  이일칠구 대시보드 — 밀린 SQL 한 번에 (038 ~ 042)
--
--  쓰는 법: Supabase → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
--  전부 되거나 전부 안 되거나다. 중간에 멈추면 아무것도 안 바뀐다.
--  여러 번 돌려도 안전하다 (이미 있는 건 건너뛴다).
-- ══════════════════════════════════════════════════════════════


-- ━━━━━━━━━━ 038_rls_speed  ·  RLS 속도 — 목록이 느리던 것 ━━━━━━━━━━
-- 메모·미리알림이 느린 근본 원인을 없앤다.
--
-- 지금은 정책이 행마다 can_see_scope() 를 부르는데, 이 함수가 plpgsql + security definer 라
-- 플래너가 질의 안으로 펼치지 못한다. 그 안에서 current_username() 이 JWT 를 매번 다시 파싱한다.
-- 메모 200줄이면 JWT 파싱 200번. 줄이 늘수록 느려진다.
--
-- 고치는 방법: 같은 뜻의 SQL 함수로 바꾼다. SQL + stable 이면 플래너가 인라인해서
-- current_username() 을 질의당 한 번만 계산한다. security definer 는 떼야 인라인된다 —
-- 이 함수는 테이블을 직접 읽지 않고(can_access_brand 가 제 권한을 그대로 들고 있다) 안전하다.

-- 1) 사용자 이름: SQL·stable 그대로 두되 안전한 search_path 를 못 박는다
create or replace function public.current_username() returns text
language sql stable
set search_path = public
as $$ select split_part(auth.jwt()->>'email','@',1) $$;

-- 2) 볼 수 있는가: plpgsql + security definer → SQL + stable (인라인 대상)
create or replace function public.can_see_scope(p_scope text, p_owner text, p_brand uuid)
returns boolean
language sql stable
set search_path = public
as $$
  select case
    when p_scope = 'private' then p_owner is not distinct from public.current_username()
    when p_scope = 'project' then p_brand is null or public.can_access_brand(p_brand)
    else true
  end
$$;

-- 3) 자주 훑는 자리에 인덱스
create index if not exists idx_notes_folder_updated on notes(folder, updated_at desc);
create index if not exists idx_notes_owner_scope    on notes(owner, scope);
create index if not exists idx_rem_done_due         on reminders(done, due_date);

-- 4) 권한(기존과 동일하게 유지)
revoke all on function public.can_see_scope(text, text, uuid) from public;
grant execute on function public.can_see_scope(text, text, uuid) to authenticated;
revoke all on function public.current_username() from public;
grant execute on function public.current_username() to authenticated;

notify pgrst, 'reload schema';

-- 확인용 (선택): 인라인됐는지 보려면
--   explain analyze select * from notes where folder <> '스티커' order by updated_at desc limit 200;
--   → 'Function Scan on can_see_scope' 가 사라지고 조건이 펼쳐져 있으면 성공.


-- ━━━━━━━━━━ 039_news  ·  뉴스 탭 — 경쟁사·후기·트렌드 ━━━━━━━━━━
-- 뉴스 탭 — 바깥에서 보는 기준을 모은다.
--  ① 경쟁사: 인스타 비즈니스 계정의 공개 지표(팔로워·게시물·최근 글)
--  ② 후기: 네이버 블로그·카페·뉴스, 구글에서 우리 브랜드 이름이 나온 글
--  ③ 트렌드: 검색어 추이·행사 일정
-- 수집은 서버(GitHub Actions)가 한다 — API 키가 브라우저로 내려가면 안 된다.

-- 1) 지켜볼 경쟁사 (인스타 핸들)
create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- 보여줄 이름
  handle text not null,                  -- @없이 (예: bebedebebe)
  ig_business_id text,                   -- 채워지면 자동 수집이 돈다
  memo text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (handle)
);

-- 2) 경쟁사 스냅샷 (하루 한 줄)
create table if not exists competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  snap_date date not null,
  followers integer,
  media_count integer,
  posts_delta integer not null default 0,   -- 직전 스냅샷 이후 올린 개수
  avg_likes numeric,                        -- 최근 글 평균 좋아요
  avg_comments numeric,
  created_at timestamptz not null default now(),
  unique (competitor_id, snap_date)
);

-- 3) 바깥 글 (후기·뉴스·트렌드가 한 테이블에 들어간다)
create table if not exists news_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                    -- review | news | trend | competitor_post
  source text not null,                  -- naver_blog | naver_cafe | naver_news | google | instagram | datalab
  brand_id uuid references brands(id) on delete set null,
  competitor_id uuid references competitors(id) on delete cascade,
  title text,
  snippet text,
  url text,
  author text,
  thumb text,
  score numeric,                         -- 트렌드 지수 등 숫자 한 개
  published_at timestamptz,
  meta jsonb,
  created_at timestamptz not null default now(),
  unique (kind, url)
);
create index if not exists idx_news_kind_pub on news_items(kind, published_at desc);
create index if not exists idx_news_brand on news_items(brand_id);
create index if not exists idx_compsnap_date on competitor_snapshots(competitor_id, snap_date desc);

-- 4) RLS — 로그인한 사람은 보고, 마스터·직원은 고친다
alter table competitors           enable row level security;
alter table competitor_snapshots  enable row level security;
alter table news_items            enable row level security;

drop policy if exists comp_sel on competitors;
create policy comp_sel on competitors for select to authenticated using (true);
drop policy if exists comp_ins on competitors;
create policy comp_ins on competitors for insert to authenticated with check (get_user_role() in ('MASTER','STAFF'));
drop policy if exists comp_upd on competitors;
create policy comp_upd on competitors for update to authenticated using (get_user_role() in ('MASTER','STAFF'));
drop policy if exists comp_del on competitors;
create policy comp_del on competitors for delete to authenticated using (get_user_role()='MASTER');

drop policy if exists csnap_sel on competitor_snapshots;
create policy csnap_sel on competitor_snapshots for select to authenticated using (true);

drop policy if exists news_sel on news_items;
create policy news_sel on news_items for select to authenticated using (true);

notify pgrst, 'reload schema';


-- ━━━━━━━━━━ 040_project_members  ·  시즌 담당자 권한 · 메모 공개/비공개 ━━━━━━━━━━
-- 프로젝트별 담당자와 공개 범위.
--  · 프로젝트에 '전체 권한' / '담당자만' 둘 중 하나를 둔다.
--  · 메모는 공개(폴더 권한대로) / 비공개(만든 사람 + 그 프로젝트 담당자만).
-- ※ 화면에서 거르는 건 '보기 좋게' 하는 것일 뿐 보안이 아니다.
--    이 파일을 실행해야 서버가 실제로 막아준다.

alter table products add column if not exists access  text not null default 'all';   -- all | members
alter table products add column if not exists members text[] not null default '{}';  -- 담당자 username 목록
alter table products drop constraint if exists products_access_chk;
alter table products add  constraint products_access_chk check (access in ('all','members'));
create index if not exists idx_products_members on products using gin(members);

-- 이 프로젝트를 볼 수 있나 (브랜드 권한 + 담당자 지정)
create or replace function public.can_access_project(p_id uuid)
returns boolean language sql stable
set search_path = public
as $$
  select case
    when p_id is null then true
    else exists (
      select 1 from products p
       where p.id = p_id
         and (p.brand_id is null or public.can_access_brand(p.brand_id))
         and (p.access = 'all'
              or public.current_username() = any(p.members)
              or public.get_user_role() = 'MASTER')
    )
  end
$$;
revoke all on function public.can_access_project(uuid) from public;
grant execute on function public.can_access_project(uuid) to authenticated;

-- 메모: 프로젝트 권한을 먼저 보고, 비공개면 만든 사람·담당자만
create or replace function public.can_see_note(p_scope text, p_owner text, p_product uuid, p_brand uuid)
returns boolean language sql stable
set search_path = public
as $$
  select public.can_access_project(p_product)
     and (p_brand is null or public.can_access_brand(p_brand))
     and (
       p_scope <> 'private'
       or p_owner is not distinct from public.current_username()
       or public.get_user_role() = 'MASTER'
       or (p_product is not null and exists (
             select 1 from products p
              where p.id = p_product and public.current_username() = any(p.members)))
     )
$$;
revoke all on function public.can_see_note(text, text, uuid, uuid) from public;
grant execute on function public.can_see_note(text, text, uuid, uuid) to authenticated;

drop policy if exists notes_select on notes;
create policy notes_select on notes for select to authenticated
  using (can_see_note(scope, owner, product_id, brand_id));
drop policy if exists notes_update on notes;
create policy notes_update on notes for update to authenticated
  using (can_see_note(scope, owner, product_id, brand_id));

-- 미리알림도 프로젝트에 붙어 있으면 같은 규칙
drop policy if exists rem_select on reminders;
create policy rem_select on reminders for select to authenticated
  using (can_access_project(product_id)
         and (scope <> 'private'
              or owner is not distinct from current_username()
              or get_user_role() = 'MASTER'));
drop policy if exists rem_update on reminders;
create policy rem_update on reminders for update to authenticated
  using (can_access_project(product_id)
         and (scope <> 'private'
              or owner is not distinct from current_username()
              or get_user_role() = 'MASTER'));

-- 할일(todos)도 프로젝트를 따른다
drop policy if exists todos_select_proj on todos;
create policy todos_select_proj on todos for select to authenticated
  using (can_access_project(product_id));

notify pgrst, 'reload schema';


-- ━━━━━━━━━━ 041_product_items  ·  제품리스트 표 ━━━━━━━━━━
-- ============================================
-- 제품리스트(product_items) — 생산의 중심 표
-- Supabase SQL Editor에서 실행 (007_vendors, 008_quotes, 013_tech_packs, 040_project_members 이후)
--
-- 'products' 테이블은 이제 화면에서 **시즌**으로 부른다(= 프로젝트 이름 변경).
-- 제품 한 줄이 시즌·공장·작업지시서·샘플·견적을 모두 물고 있어
-- 어디서 열어도 같은 줄을 보게 만든다.
-- ============================================

CREATE TABLE IF NOT EXISTS product_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID REFERENCES brands(id)   ON DELETE SET NULL,  -- 브랜드
  name         TEXT NOT NULL DEFAULT '',                         -- 이름
  pattern_no   TEXT,                                             -- 패턴명
  status       TEXT NOT NULL DEFAULT '요청하기',                  -- 제작현황
  memo         TEXT,
  trims        BOOLEAN NOT NULL DEFAULT false,                   -- 부자재
  checked      BOOLEAN NOT NULL DEFAULT false,                   -- 체크
  vendor_id    UUID REFERENCES vendors(id)  ON DELETE SET NULL,  -- 공장
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,  -- 시즌
  ship_date    DATE,                                             -- 출고예정일
  open_date    DATE,                                             -- 오픈일
  -- ── 연동 ──
  tech_pack_id UUID REFERENCES tech_packs(id) ON DELETE SET NULL, -- 작업지시서·샘플디자인
  quote_id     UUID REFERENCES quotes(id)     ON DELETE SET NULL, -- 견적
  sort         INT  NOT NULL DEFAULT 0,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pitem_season ON product_items(product_id);
CREATE INDEX IF NOT EXISTS idx_pitem_brand  ON product_items(brand_id);
CREATE INDEX IF NOT EXISTS idx_pitem_vendor ON product_items(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pitem_tp     ON product_items(tech_pack_id);

DROP TRIGGER IF EXISTS product_items_updated_at ON product_items;
CREATE TRIGGER product_items_updated_at BEFORE UPDATE ON product_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 거꾸로도 찾을 수 있게 — 작업지시서/견적/생산작업에서 제품 줄로
ALTER TABLE tech_packs  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES product_items(id) ON DELETE SET NULL;
ALTER TABLE quotes      ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES product_items(id) ON DELETE SET NULL;
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES product_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tp_item  ON tech_packs(item_id);
CREATE INDEX IF NOT EXISTS idx_q_item   ON quotes(item_id);
CREATE INDEX IF NOT EXISTS idx_vj_item  ON vendor_jobs(item_id);

-- RLS — 브랜드 권한 + 시즌(프로젝트) 담당자 권한을 모두 따른다
ALTER TABLE product_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pitem_select ON product_items;
DROP POLICY IF EXISTS pitem_write  ON product_items;
DROP POLICY IF EXISTS pitem_update ON product_items;
DROP POLICY IF EXISTS pitem_delete ON product_items;

CREATE POLICY pitem_select ON product_items FOR SELECT TO authenticated
  USING (
    (brand_id IS NULL OR can_access_brand(brand_id))
    AND (product_id IS NULL OR can_access_project(product_id))
  );
CREATE POLICY pitem_write ON product_items FOR INSERT TO authenticated
  WITH CHECK (brand_id IS NULL OR can_access_brand(brand_id));
CREATE POLICY pitem_update ON product_items FOR UPDATE TO authenticated
  USING (brand_id IS NULL OR can_access_brand(brand_id))
  WITH CHECK (brand_id IS NULL OR can_access_brand(brand_id));
CREATE POLICY pitem_delete ON product_items FOR DELETE TO authenticated
  USING (get_user_role() = 'MASTER' OR (brand_id IS NULL OR can_access_brand(brand_id)));

SELECT 'product_items + tech_packs/quotes/vendor_jobs.item_id installed' AS status;


-- ━━━━━━━━━━ 042_import_notion_products  ·  노션 제품 102개 가져오기 ━━━━━━━━━━
-- ============================================
-- 노션 '제품리스트2' + '제품리스트' → product_items
-- 출처: ~/Downloads/..._Export-8585a931-...zip (2026-09-29 내보내기)
-- Supabase SQL Editor 에서 041_product_items.sql 다음에 실행.
-- 같은 이름의 제품이 이미 있으면 건너뛴다 — 여러 번 돌려도 안전하다.
--
-- 노션에 '시즌' 열이 없어서 시즌은 비워 둔다. 화면에서 골라 붙이면 된다.
-- ============================================

-- 1) 노션에 있던 공장을 거래처로 (없을 때만)
INSERT INTO vendors (name, category)
SELECT v.name, '봉제' FROM (VALUES
  ('광명'),
  ('영진 다이마루'),
  ('영진사')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM vendors x WHERE x.name = v.name);

-- 2) 제품 줄
INSERT INTO product_items
  (name, pattern_no, status, memo, trims, checked, brand_id, vendor_id, ship_date, open_date)
SELECT s.name, s.pattern_no, s.status, s.memo, s.trims, s.checked,
       (SELECT id FROM brands  b WHERE b.name = s.brand  LIMIT 1),
       (SELECT id FROM vendors v WHERE v.name = s.vendor LIMIT 1),
       s.ship_date, s.open_date
FROM (VALUES
  ('HUG ME SETUP (양기모셋업)',NULL,'출고완료',NULL,false,false,'하이헤이호','광명','2025-11-28'::date,'2025-12-04'::date),
  ('Holiday ST-T shirt(폴라티)',NULL,'출고완료',NULL,false,false,'하이헤이호','광명','2025-11-28'::date,'2025-12-04'::date),
  ('TEDDY BOUCLE CARDIGAN(브이가디건)',NULL,'출고완료',NULL,false,false,'하이헤이호','광명','2025-11-28'::date,'2025-12-04'::date),
  ('HOLIDAY STRIPE PANTS (홀리데이팬츠)',NULL,'출고완료',NULL,false,false,'하이헤이호','광명','2025-11-28'::date,'2025-12-04'::date),
  ('BOUCLE HOODIE (hhh후드)',NULL,'출고완료',NULL,false,false,'하이헤이호','광명','2025-11-28'::date,'2025-12-04'::date),
  ('FLEECE HOOD ZIP-UP SET (후리스셋)',NULL,'출고완료',NULL,false,false,'하이헤이호','광명','2025-11-28'::date,'2025-12-04'::date),
  ('HHH CAMP CAP',NULL,'출고완료',NULL,false,false,'하이헤이호','광명','2025-11-28'::date,'2025-12-04'::date),
  ('✔️배색티','H261TS003','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('✔️브이뒷절개','브이 뒷절개 맨투맨','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('✔️토-기본부츠컷','토비 기본 부츠컷','출고완료',NULL,true,false,'토비','광명',NULL::date,NULL::date),
  ('✔️토-일자바지','토비일자바지','출고완료',NULL,true,false,'토비','광명',NULL::date,NULL::date),
  ('✔️토-기본가디건','T26CD','출고완료',NULL,true,false,'토비','광명',NULL::date,NULL::date),
  ('✔️오버롤','헤링본멜빵','출고완료','2/4출고예정',true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('✔️ST바막','H261O001 ST바람막이','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('보류)mtm setup','L261TS004','보류',NULL,false,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('커브팬츠','H261PT002','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('스트라이프 데님','H261TPT001','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('코지가디건','코코베베가디건','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('✔️강아지티','H261TS003','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('부츠컷레이어드','H261PT003','출고완료','그린/메란지',true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('배색티','H261TS001','출고완료',NULL,true,false,'토비','광명',NULL::date,NULL::date),
  ('✔️삥줄바람막이','L261JP001','출고완료','2/4 자수들어감',true,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('✔️모자리벳바지','슬라비데님팬츠','출고완료',NULL,true,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('✔️로고볼캡',NULL,'출고완료',NULL,true,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('✔️기본셔츠','L261BL001','출고완료','2/4 자수들어감',true,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('기본티','H261TS005토비','출고완료',NULL,true,false,'토비','광명',NULL::date,NULL::date),
  ('기본쭉티','H261TS005','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('고쟁이',NULL,'출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('나시',NULL,'출고완료','메인',true,false,'토비','영진 다이마루',NULL::date,NULL::date),
  ('랍빠 모달티','H261TS003 강아지티','보류','재샘',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('나시 블라우스','H262BL002','출고완료','3.12메인요청',true,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('나시/긴바지 세트','H262BL003 수','출고완료','3.12메인요청',true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('나시 린넨반바지슈트','H2620P001','요청하기','원단바꿔서 재샘보기',false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('린넨 단추 슈트','T262PT004','출고완료','3.12 반바지로 수정요청(영진사로택배)',false,false,'토비','영진사',NULL::date,NULL::date),
  ('고방 조거팬츠','홀리데이팬츠','출고완료','3.12 메인',true,false,'토비','광명',NULL::date,NULL::date),
  ('텐더ST썸머슈트',NULL,'보류','패턴요청함',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('반바지 워싱데님','샌드팬츠','보류',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('모달부츠컷',NULL,'출고완료','3.12 메인',true,false,'토비','광명',NULL::date,NULL::date),
  ('모달절개 반팔티',NULL,'출고완료','📍그레이딩요청해야함',true,false,'토비','광명',NULL::date,NULL::date),
  ('나그랑 모달쫄티','📍패턴요청 H261TS007변형하여 L','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('바이커팬츠',NULL,'보류','컬러 골지로',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('과일반팔 반바지셋업',NULL,'출고완료','티셔츠원단 확인, 바지 샘플요청함',true,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('깅엄원피스',NULL,'출고완료','블랙 바지 샘플 보고 아더컬러 결정',true,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('썸머가디건',NULL,'출고완료','3.23라운드로 변경하여 샘플 요청',false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('단추나시반바지',NULL,'보류',NULL,false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('기본 린넨셔츠',NULL,'샘플 중','5.13 재샘',false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('롤업데님반바지',NULL,'출고완료',NULL,true,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('배색모달티',NULL,'보류',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('조거팬츠',NULL,'보류','오픈 여부 의논 필',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('논페이드 데님',NULL,'출고완료',NULL,false,false,'로하이스튜디오','영진사',NULL::date,NULL::date),
  ('논페이드 셔츠',NULL,'출고완료','주머니 내리고, 지니포인트, 현샘플2',false,false,'로하이스튜디오','영진사',NULL::date,NULL::date),
  ('바람막이',NULL,'출고완료',NULL,false,false,'로하이스튜디오','영진사',NULL::date,NULL::date),
  ('기본로고티',NULL,'출고완료',NULL,false,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('일자바스락바지',NULL,'보류',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('캡모자',NULL,'출고완료',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('화섬바지',NULL,'출고완료',NULL,false,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('깅엄일자바지 (원피스동일)',NULL,'출고완료',NULL,true,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('배색나시','25마룬나시','출고완료',NULL,true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('보트넥티',NULL,'메인투입','5.8 재샘 요청함',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('바스락바지',NULL,'출고완료','21일 패턴나옴',false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('단가라바지','모닝골덴하의','출고완료',NULL,true,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('피그먼트티셔츠',NULL,'보류',NULL,false,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('워싱데님',NULL,'보류','5.12 워싱 다시 감',false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('깅엄 반바지',NULL,'보류',NULL,false,false,'토비','광명',NULL::date,NULL::date),
  ('쫄 끈나시',NULL,'샘플 중','5.12 패턴수정요청',false,false,'토비','광명',NULL::date,NULL::date),
  ('아일렛 티셔츠',NULL,'보류',NULL,false,false,'토비','광명',NULL::date,NULL::date),
  ('롱치마',NULL,'출고완료','5.8 패턴 수정 후 그레이딩 요청',false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('안경티',NULL,'출고완료','크림/그레이/ 미션20스판',true,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('고등어/조개티','데이랍빠티(네크립으로)','출고완료','샘플감에 나염 쳐보기',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('카라상하세트 삥줄',NULL,'보류',NULL,false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('쭈리카고팬츠',NULL,'출고완료',NULL,true,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('뒷절개스판티',NULL,'메인투입','컬러/디테일 고르기',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('어깨 밴드 티셔츠',NULL,'요청하기',NULL,false,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('st부츠컷',NULL,'출고완료',NULL,true,false,'토비','광명','2026-05-29'::date,NULL::date),
  ('끈나시','H261TS024','원단/부자재 발주','아이엠30/가디건세트나시로 샘중',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('로고기본티',NULL,'메인투입','나염 배색',false,false,'로하이스튜디오','광명',NULL::date,NULL::date),
  ('린넨슈트',NULL,'보류','허리선2cm 기장5cm 올림',false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('나그랑 기본티셔츠',NULL,'출고완료',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('가디건+나시셋업',NULL,'보류','원단 바꿔야함',false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('일자바지+주머니',NULL,'보류',NULL,false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('셔츠셋업',NULL,'메인투입',NULL,false,false,'토비','광명',NULL::date,NULL::date),
  ('차르르셔츠',NULL,'메인투입',NULL,false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('화섬 반바지 스티치',NULL,'샘플 중',NULL,false,false,'로하이스튜디오','영진사',NULL::date,NULL::date),
  ('니트비니',NULL,'보류',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('워싱진',NULL,'샘플 중',NULL,false,false,'하이헤이호','영진사',NULL::date,NULL::date),
  ('쫄티','H261TS001스판','메인투입',NULL,false,true,'하이헤이호','광명',NULL::date,NULL::date),
  ('나그랑 배색 맨투맨',NULL,'메인투입',NULL,false,true,'하이헤이호','광명',NULL::date,NULL::date),
  ('털조끼',NULL,'메인투입',NULL,false,true,'하이헤이호','영진사',NULL::date,NULL::date),
  ('쭈리셋업',NULL,'메인투입',NULL,false,true,'하이헤이호','광명',NULL::date,NULL::date),
  ('부츠컷','H261PT003','요청하기',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('ST 일자바지',NULL,'보류',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('이진이슈트',NULL,'보류',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('골덴 데님(워싱)',NULL,'시작전',NULL,false,false,NULL,'광명',NULL::date,NULL::date),
  ('러브후디셋업 나그랑?',NULL,'시작전',NULL,false,false,NULL,'광명',NULL::date,NULL::date),
  ('빵아플리케 맨투맨',NULL,'시작전',NULL,false,false,NULL,'광명',NULL::date,NULL::date),
  ('나그랑셋업(러브후디)',NULL,'메인투입',NULL,false,false,'하이헤이호','광명',NULL::date,NULL::date),
  ('기본셔츠',NULL,'메인투입','업무상태: 시작 전 · 결제 완료',false,false,'로하이스튜디오',NULL,NULL::date,NULL::date),
  ('삥줄바람막이',NULL,'메인투입','업무상태: 시작 전 · 결제 완료',false,false,'로하이스튜디오',NULL,NULL::date,NULL::date),
  ('로고볼캡',NULL,'원단/부자재 발주','업무상태: 시작 전',false,false,'로하이스튜디오',NULL,NULL::date,NULL::date),
  ('✔️배색반팔티',NULL,'메인투입','업무상태: 시작 전',false,false,'하이헤이호',NULL,NULL::date,NULL::date),
  ('레이어드나시',NULL,'샘플 중','업무상태: 시작 전',false,false,'토비',NULL,NULL::date,NULL::date),
  ('로하이기본티',NULL,'시작전','업무상태: 시작 전',false,false,'로하이스튜디오',NULL,NULL::date,NULL::date)
) AS s(name, pattern_no, status, memo, trims, checked, brand, vendor, ship_date, open_date)
WHERE NOT EXISTS (SELECT 1 FROM product_items p WHERE p.name = s.name);

SELECT count(*) || '개 제품이 제품리스트에 있습니다' AS status FROM product_items;
