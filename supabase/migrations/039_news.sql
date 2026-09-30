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
