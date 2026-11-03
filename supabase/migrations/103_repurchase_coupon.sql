-- 103 재구매 쿠폰 주기 설정·관리 — 1-A (기획 v2: .work/재구매쿠폰/기획.md)
--
-- 밖으로 아무것도 쓰지 않는다. 규칙 → 정해진 시각에 명단을 고정한 회차 → 사람 승인 → CSV(회원 ID) →
-- 카페24 관리자에 사람이 올린 뒤 [업로드 완료 확인](담당·시각·건수·증빙)까지가 1-A 다.
-- 'issued' 는 수동 확인(coupon_run_confirm_manual) 한 곳에서만 생긴다. 승인·CSV·만료는 발급이 아니다(4-0).
-- 카페24 API 발급(1-B)·문자·메일은 없다. 이 파일에 외부 호출(net.http_*)이 없다.
--
-- 표 5개: coupon_rules · coupon_rule_versions · coupon_runs · coupon_run_members · coupon_audit
-- 읽기: 직원(is_staff) 중 그 브랜드 권한(can_access_brand — 028/088 과 같은 규칙)이 있는 사람만.
-- 쓰기: 아래 security definer RPC 만(안에서 역할 + 브랜드 검사). 표 직접 쓰기 정책 없음.
-- 대상 판정은 한 곳(_coupon_member_stats + coupon_target_match): 미리보기·회차·repurchase_targets·CRM 탭(repurchase_segments)이 같이 쓴다.
-- 수동 확인 증빙은 서버가 storage 에서 실제 파일(이 회차 폴더 · 확인하는 사람이 올림 · CSV 뒤)을 확인한다.
-- 모든 날짜 판정은 KST.

-- ============================================================
-- 1) 표
-- ============================================================
create table if not exists public.coupon_rules (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  target jsonb not null default '{}'::jsonb,     -- {preset:'first30'|'dormant90'|'dormant180'|'vip_risk'|null, gone_min, gone_max, orders_min, orders_max, spend_min}
  coupon jsonb not null default '{}'::jsonb,     -- {cafe24_coupon_no, memo, max_discount, valid_days}
  schedule jsonb not null default '{}'::jsonb,   -- {freq:'weekly'|'monthly'|'every_n', weekday(1=월..7=일), monthday, every_days, time_kst:'10:00', start_date, end_date}
  control_pct int not null default 10 check (control_pct between 0 and 50),
  cooldown_days int not null default 90 check (cooldown_days between 0 and 3650),
  max_targets int not null default 500 check (max_targets between 1 and 100000),
  priority int not null default 100,
  next_run_at timestamptz,
  version int not null default 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coupon_rule_versions (
  rule_id uuid not null references public.coupon_rules(id),
  version int not null,
  snapshot jsonb not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  primary key (rule_id, version)
);

create table if not exists public.coupon_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.coupon_rules(id),
  rule_version int not null,
  rule_snapshot jsonb not null,
  scheduled_for timestamptz not null,
  as_of_date date not null,
  status text not null default 'awaiting_approval' check (status in (
    'awaiting_approval', 'needs_review', 'rejected', 'expired',      -- 승인 전
    'approved_for_export', 'exported', 'export_expired',              -- 1-A (발급 아님)
    'approved', 'issuing', 'blocked',                                 -- 1-B (이번엔 안 씀)
    'done', 'partial', 'failed', 'cancelled')),                       -- 확정 결과
  issue_path text check (issue_path in ('manual_upload', 'api')),
  matched_n int not null default 0,       -- 제외 전 묶음 해당 수
  target_n int not null default 0,        -- 발송군
  control_n int not null default 0,       -- 대조군
  excluded_n int not null default 0,
  exclude_counts jsonb not null default '{}'::jsonb,
  max_discount_exposure numeric,
  approved_by uuid, approved_at timestamptz,
  rejected_reason text,
  exported_by uuid, exported_at timestamptz,
  manual_owner text, manual_confirmed_by uuid, manual_uploaded_at timestamptz,
  manual_reported_n int, manual_evidence_path text, manual_confirmed_at timestamptz,
  started_at timestamptz, finished_at timestamptz, last_error text,
  created_at timestamptz not null default now(),
  unique (rule_id, scheduled_for)
);

create table if not exists public.coupon_run_members (
  run_id uuid not null references public.coupon_runs(id),
  member_id text not null,
  mall_key text,
  name_masked text,
  last_date date, gone_days int, orders int, spend numeric,
  arm text check (arm in ('treat', 'control')),
  status text not null check (status in ('pending', 'not_confirmed', 'issued', 'failed', 'unknown', 'skipped',
                                         'cancelled', 'excluded', 'control', 'control_counted')),
  issue_path text check (issue_path in ('manual_upload', 'api')),
  exclude_reason text,
  attempts int not null default 0,
  last_error text,
  cafe24_ref text,
  issued_at timestamptz,
  primary key (run_id, member_id),
  check (status <> 'issued' or (issue_path is not null and issued_at is not null)),
  check (status <> 'control_counted' or issued_at is not null)
);
create index if not exists coupon_run_members_cool on public.coupon_run_members (member_id, issued_at)
  where status in ('issued', 'control_counted');

create table if not exists public.coupon_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  rule_id uuid, run_id uuid,
  detail jsonb not null default '{}'::jsonb
);

alter table public.coupon_rules enable row level security;
alter table public.coupon_rule_versions enable row level security;
alter table public.coupon_runs enable row level security;
alter table public.coupon_run_members enable row level security;
alter table public.coupon_audit enable row level security;

--  브랜드 권한 — RLS·RPC·증빙 버킷이 모두 이것만 본다. service_role 은 통과(서버 작업), 그 밖은 can_access_brand.
create or replace function public._coupon_brand_ok(p_brand uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_brand is not null
     and (coalesce(auth.jwt()->>'role', '') = 'service_role' or coalesce(public.can_access_brand(p_brand), false))
$$;

create or replace function public._coupon_guard_brand(p_brand uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public._coupon_brand_ok(p_brand) then raise exception '이 브랜드 권한이 없습니다' using errcode = '42501'; end if;
end $$;

--  화면에서 받은 규칙 값(p_rule) 검사: brand_id 권한 + id 를 주면 그 규칙도 같은 브랜드여야 한다(남의 규칙 id 로 쿨다운·우선순위 엿보기 막음).
create or replace function public._coupon_guard_rule_input(p_rule jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
declare bid uuid := nullif(p_rule->>'brand_id', '')::uuid; rid uuid := nullif(p_rule->>'id', '')::uuid; rb uuid;
begin
  perform public._coupon_guard_brand(bid);
  if rid is not null then
    select brand_id into rb from coupon_rules where id = rid;
    if rb is distinct from bid then raise exception '이 브랜드 규칙이 아닙니다' using errcode = '42501'; end if;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['coupon_rules', 'coupon_rule_versions', 'coupon_runs', 'coupon_run_members', 'coupon_audit'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy coupon_rules_staff_read on public.coupon_rules for select to authenticated
  using (public.is_staff() and public._coupon_brand_ok(brand_id));
create policy coupon_rule_versions_staff_read on public.coupon_rule_versions for select to authenticated
  using (public.is_staff() and exists (select 1 from public.coupon_rules r where r.id = rule_id and public._coupon_brand_ok(r.brand_id)));
create policy coupon_runs_staff_read on public.coupon_runs for select to authenticated
  using (public.is_staff() and exists (select 1 from public.coupon_rules r where r.id = rule_id and public._coupon_brand_ok(r.brand_id)));
create policy coupon_run_members_staff_read on public.coupon_run_members for select to authenticated
  using (public.is_staff() and exists (select 1 from public.coupon_runs x join public.coupon_rules r on r.id = x.rule_id
                                        where x.id = run_id and public._coupon_brand_ok(r.brand_id)));
create policy coupon_audit_staff_read on public.coupon_audit for select to authenticated
  using (public.is_staff() and exists (select 1 from public.coupon_rules r where r.id = rule_id and public._coupon_brand_ok(r.brand_id)));

-- ============================================================
-- 2) 다음 실행 — KST. 매월 31일처럼 없는 날은 그달 말일. p_after 보다 '뒤' 첫 시각. 종료일 넘으면 null.
--    같은 계산을 화면(repurchaseCoupon.js nextRunAt)도 한다 — 테스트가 둘을 맞춰 본다.
-- ============================================================
create or replace function public.coupon_next_run(p_sched jsonb, p_after timestamptz)
returns timestamptz language plpgsql immutable set search_path = public as $$
declare
  freq text := p_sched->>'freq';
  tm time := coalesce(nullif(p_sched->>'time_kst', ''), '10:00')::time;
  sd date := nullif(p_sched->>'start_date', '')::date;
  ed date := nullif(p_sched->>'end_date', '')::date;
  base date := (p_after at time zone 'Asia/Seoul')::date;
  d date; m date; ts timestamptz; i int; k int; n int; md int;
begin
  if sd is not null and sd > base then base := sd; end if;
  if freq = 'weekly' then
    for i in 0..7 loop
      d := base + i;
      if extract(isodow from d)::int = (p_sched->>'weekday')::int then
        ts := (d + tm) at time zone 'Asia/Seoul';
        if ts > p_after then exit; end if;
      end if;
      ts := null;
    end loop;
  elsif freq = 'monthly' then
    md := (p_sched->>'monthday')::int;
    for i in 0..13 loop
      m := (date_trunc('month', base) + make_interval(months => i))::date;
      d := m + (least(md, extract(day from (m + interval '1 month - 1 day'))::int) - 1);
      ts := (d + tm) at time zone 'Asia/Seoul';
      if ts > p_after and d >= coalesce(sd, d) then exit; end if;
      ts := null;
    end loop;
  elsif freq = 'every_n' then
    n := (p_sched->>'every_days')::int;
    if n is null or n < 1 then raise exception 'N일마다 간격이 없습니다'; end if;
    sd := coalesce(sd, base);
    k := greatest(0, (base - sd) / n - 1);
    loop
      d := sd + k * n;
      ts := (d + tm) at time zone 'Asia/Seoul';
      exit when ts > p_after;
      k := k + 1;
    end loop;
  else
    raise exception '알 수 없는 주기: %', freq;
  end if;
  if ts is null then return null; end if;
  if ed is not null and (ts at time zone 'Asia/Seoul')::date > ed then return null; end if;
  return ts;
end $$;

-- ============================================================
-- 3) 대상 판정 — 한 곳에서(4-3). 미리보기와 회차 생성이 같은 함수를 쓴다.
--    유효 주문 = 결제액 있음 · op_status 가 cancel/return 아님 · KST 기준일 이하. 카페24 몰(그 브랜드)만.
--    회원 = raw.member_id (없으면 loginId) — CRM 탭과 같은 식.
-- ============================================================
create or replace function public.coupon_bucket(p_member text)
returns int language sql immutable as $$
  select (('x' || '00000000' || left(md5(p_member), 8))::bit(64)::bigint % 100)::int
$$;

create or replace function public.coupon_mask_name(p text)
returns text language sql immutable as $$
  select case when p is null or btrim(p) = '' then '—'
              when char_length(btrim(p)) = 1 then btrim(p)
              when char_length(btrim(p)) = 2 then left(btrim(p), 1) || '*'
              else left(btrim(p), 1) || repeat('*', char_length(btrim(p)) - 2) || right(btrim(p), 1) end
$$;

--  회원별 집계(내부용 — 직접 호출 권한 없음)
create or replace function public._coupon_member_stats(p_brand uuid, p_as_of date)
returns table (member_id text, mall_key text, name text, first_date date, last_date date, orders int, spend numeric,
               gone_days int, avg_cycle numeric, vip boolean, shared_phone boolean, open_cs boolean)
language sql stable security definer set search_path = public as $$
  with o as (
    select co.id, co.mall_key,
           btrim(coalesce(nullif(btrim(co.raw->>'member_id'), ''), co.raw->>'loginId')) mem,
           (co.order_date at time zone 'Asia/Seoul')::date d, co.order_date,
           coalesce(co.actual_paid_amount, co.pay_amount) amt,
           coalesce(co.buyer_name, co.receiver_name) nm,
           nullif(regexp_replace(coalesce(co.receiver_phone, ''), '[^0-9]', '', 'g'), '') phone
      from channel_orders co
      join malls ml on ml.mall_key = co.mall_key
     where ml.brand_id = p_brand and coalesce(ml.channel, 'cafe24') = 'cafe24' and ml.active is not false
       and co.order_date is not null
       and (co.actual_paid_amount is not null or co.pay_amount is not null)
       and lower(coalesce(co.op_status, '')) not in ('cancel', 'return')
       and (co.order_date at time zone 'Asia/Seoul')::date <= p_as_of
  ), v as (select * from o where mem is not null and mem <> ''),
  agg as (
    select v.mem, (array_agg(v.mall_key order by v.order_date desc, v.id))[1] mall_key,
           (array_agg(v.nm order by v.order_date desc, v.id) filter (where v.nm is not null))[1] nm,
           min(v.d) f, max(v.d) l, count(*)::int n, sum(v.amt) s, count(distinct v.d) dd
      from v group by v.mem
  ), base as (
    select a.*, (p_as_of - a.l) gone,
           case when a.dd > 1 then (a.l - a.f)::numeric / (a.dd - 1) end cyc
      from agg a
  ), rank2 as (
    select b.mem, row_number() over (order by b.s desc, b.mem) rn, count(*) over () cnt
      from base b where b.n >= 2
  ), ph as (
    select v.phone from v where v.phone is not null group by v.phone having count(distinct v.mem) > 1
  )
  select b.mem, b.mall_key, b.nm, b.f, b.l, b.n, b.s, b.gone, b.cyc,
         coalesce(r.rn <= greatest(1, ceil(r.cnt * 0.1)), false),
         exists (select 1 from v where v.mem = b.mem and v.phone in (select phone from ph)),
         exists (select 1 from cs_tickets t join channel_orders c2 on c2.id = t.channel_order_id
                  where coalesce(t.status, '') <> '완료'
                    and btrim(coalesce(nullif(btrim(c2.raw->>'member_id'), ''), c2.raw->>'loginId')) = b.mem
                    and c2.mall_key in (select ml.mall_key from malls ml where ml.brand_id = p_brand))
    from base b left join rank2 r on r.mem = b.mem
$$;

--  규칙의 대상 조건에 맞나(묶음 + 직접 조건 AND)
create or replace function public.coupon_target_match(p_target jsonb, gone int, orders int, spend numeric, vip boolean, avg_cycle numeric)
returns boolean language sql immutable as $$
  select (case coalesce(p_target->>'preset', '')
            when 'first30' then orders = 1 and gone >= 30 and gone < 90
            when 'dormant90' then gone >= 90 and gone < 180
            when 'dormant180' then gone >= 180
            when 'vip_risk' then vip and avg_cycle is not null and gone >= greatest(1, avg_cycle * 2)
            when '' then true
            else false end)
     and (p_target->>'gone_min' is null or gone >= (p_target->>'gone_min')::int)
     and (p_target->>'gone_max' is null or gone <= (p_target->>'gone_max')::int)
     and (p_target->>'orders_min' is null or orders >= (p_target->>'orders_min')::int)
     and (p_target->>'orders_max' is null or orders <= (p_target->>'orders_max')::int)
     and (p_target->>'spend_min' is null or spend >= (p_target->>'spend_min')::numeric)
     and (coalesce(p_target->>'preset', '') <> '' or p_target ?| array['gone_min', 'gone_max', 'orders_min', 'orders_max', 'spend_min'])
$$;

--  대상 판정(내부용). p_rule = {id?, brand_id, target, control_pct, cooldown_days, priority, global_gap_days?}
--  묶음에 맞는 회원만 돌려준다. 제외면 exclude_reason, 아니면 arm(treat/control).
create or replace function public._coupon_targets(p_rule jsonb, p_as_of date)
returns table (member_id text, mall_key text, name text, last_date date, gone_days int, orders int, spend numeric,
               arm text, exclude_reason text)
language sql stable security definer set search_path = public as $$
  with p as (
    select nullif(p_rule->>'id', '')::uuid rid, (p_rule->>'brand_id')::uuid bid, coalesce(p_rule->'target', '{}'::jsonb) tg,
           coalesce((p_rule->>'control_pct')::int, 10) cp, coalesce((p_rule->>'cooldown_days')::int, 90) cd,
           coalesce((p_rule->>'priority')::int, 100) pr, coalesce((p_rule->>'global_gap_days')::int, 14) gg,
           (p_as_of::timestamp at time zone 'Asia/Seoul') day0
  ), s as (
    select st.* from p, public._coupon_member_stats(p.bid, p_as_of) st
     where public.coupon_target_match(p.tg, st.gone_days, st.orders, st.spend, st.vip, st.avg_cycle)
  )
  select s.member_id, s.mall_key, s.name, s.last_date, s.gone_days, s.orders, s.spend,
         case when public.coupon_bucket(s.member_id) < p.cp then 'control' else 'treat' end,
         case
           when s.gone_days < 7 then 'recent_order'
           when s.open_cs then 'open_cs'
           when s.shared_phone then 'shared_phone'
           when p.rid is not null and exists (
             select 1 from coupon_run_members m join coupon_runs r on r.id = m.run_id
              where r.rule_id = p.rid and m.member_id = s.member_id
                and m.status in ('issued', 'control_counted') and m.issued_at >= p.day0 - make_interval(days => p.cd)) then 'cooldown'
           when exists (
             select 1 from coupon_run_members m join coupon_runs r on r.id = m.run_id join coupon_rules ru on ru.id = r.rule_id
              where ru.brand_id = p.bid and m.member_id = s.member_id
                and m.status = 'issued' and m.issued_at >= p.day0 - make_interval(days => p.gg)) then 'global_gap'
           when exists (
             select 1 from coupon_rules o
              where o.status = 'active' and o.brand_id = p.bid and o.id is distinct from p.rid
                and (o.priority < p.pr or (o.priority = p.pr and o.id::text < coalesce(p.rid::text, '~')))
                and public.coupon_target_match(o.target, s.gone_days, s.orders, s.spend, s.vip, s.avg_cycle)) then 'other_rule'
         end
    from s, p
$$;

-- ============================================================
-- 4) 감사·역할 도우미
-- ============================================================
create or replace function public._coupon_audit(p_action text, p_rule uuid, p_run uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into coupon_audit (actor, action, rule_id, run_id, detail) values (auth.uid(), p_action, p_rule, p_run, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function public._coupon_check_rule(r public.coupon_rules)
returns void language plpgsql stable set search_path = public as $$
declare f text := r.schedule->>'freq';
begin
  if coalesce(btrim(r.coupon->>'cafe24_coupon_no'), '') = '' then raise exception '카페24 쿠폰 번호를 넣어 주세요' using errcode = '22023'; end if;
  if f not in ('weekly', 'monthly', 'every_n') then raise exception '주기를 고르세요(매주/매월/N일마다)' using errcode = '22023'; end if;
  if f = 'weekly' and coalesce((r.schedule->>'weekday')::int, 0) not between 1 and 7 then raise exception '요일을 고르세요' using errcode = '22023'; end if;
  if f = 'monthly' and coalesce((r.schedule->>'monthday')::int, 0) not between 1 and 31 then raise exception '날짜(1~31)를 넣어 주세요' using errcode = '22023'; end if;
  if f = 'every_n' and coalesce((r.schedule->>'every_days')::int, 0) < 1 then raise exception 'N일마다의 N을 넣어 주세요' using errcode = '22023'; end if;
  if coalesce(r.schedule->>'time_kst', '10:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '시각은 HH:MM' using errcode = '22023'; end if;
  if coalesce(r.target->>'preset', '') = '' and not (r.target ?| array['gone_min', 'gone_max', 'orders_min', 'orders_max', 'spend_min']) then
    raise exception '대상(묶음 또는 직접 조건)을 정해 주세요' using errcode = '22023';
  end if;
  if coalesce(r.target->>'preset', '') not in ('', 'first30', 'dormant90', 'dormant180', 'vip_risk') then raise exception '알 수 없는 묶음' using errcode = '22023'; end if;
  if not exists (select 1 from public.malls m where m.brand_id = r.brand_id and coalesce(m.channel, 'cafe24') = 'cafe24') then
    raise exception '카페24 몰이 연결된 브랜드만 고를 수 있습니다' using errcode = '22023';
  end if;
end $$;

-- ============================================================
-- 5) 규칙 RPC
-- ============================================================
--  저장 = 초안 만들기 또는 고치기(버전 +1, 스냅숏). 상태는 여기서 안 바꾼다. 운영중이면 다음 실행을 다시 계산.
create or replace function public.coupon_rule_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare r coupon_rules; old coupon_rules; rid uuid := nullif(p->>'id', '')::uuid;
begin
  perform public.require_role('MASTER', 'STAFF');
  if rid is not null then
    select * into old from coupon_rules where id = rid for update;
    if not found then raise exception '없는 규칙입니다' using errcode = 'P0002'; end if;
    perform public._coupon_guard_brand(old.brand_id);
    if old.status = 'archived' then raise exception '보관한 규칙은 고칠 수 없습니다' using errcode = '22023'; end if;
    r := old;
  else
    r.id := gen_random_uuid(); r.status := 'draft'; r.version := 0; r.created_by := auth.uid(); r.created_at := now();
  end if;
  r.brand_id := coalesce(nullif(p->>'brand_id', '')::uuid, r.brand_id);
  r.name := btrim(coalesce(p->>'name', r.name, ''));
  r.target := coalesce(p->'target', r.target, '{}'::jsonb);
  r.coupon := coalesce(p->'coupon', r.coupon, '{}'::jsonb);
  r.schedule := coalesce(p->'schedule', r.schedule, '{}'::jsonb);
  r.control_pct := coalesce((p->>'control_pct')::int, r.control_pct, 10);
  r.cooldown_days := coalesce((p->>'cooldown_days')::int, r.cooldown_days, 90);
  r.max_targets := coalesce((p->>'max_targets')::int, r.max_targets, 500);
  r.priority := coalesce((p->>'priority')::int, r.priority, 100);
  perform public._coupon_guard_brand(r.brand_id);
  if r.name = '' then raise exception '규칙 이름을 넣어 주세요' using errcode = '22023'; end if;
  perform public._coupon_check_rule(r);
  r.version := r.version + 1; r.updated_by := auth.uid(); r.updated_at := now();
  if r.status = 'active' then r.next_run_at := public.coupon_next_run(r.schedule, now()); end if;
  if rid is null then insert into coupon_rules select r.*;
  else update coupon_rules set brand_id = r.brand_id, name = r.name, target = r.target, coupon = r.coupon, schedule = r.schedule,
         control_pct = r.control_pct, cooldown_days = r.cooldown_days, max_targets = r.max_targets, priority = r.priority,
         next_run_at = r.next_run_at, version = r.version, updated_by = r.updated_by, updated_at = r.updated_at where id = r.id;
  end if;
  insert into coupon_rule_versions (rule_id, version, snapshot, changed_by) values (r.id, r.version, to_jsonb(r), auth.uid());
  perform public._coupon_audit(case when rid is null then 'rule_create' else 'rule_update' end, r.id, null,
    jsonb_build_object('version', r.version, 'status', r.status));
  return r.id;
end $$;

--  운영 시작·일시중지·보관(MASTER). 시작/재개하면 다음 실행을 '지금' 기준으로 다시(멈춘 기간 회차는 안 만든다).
create or replace function public.coupon_rule_set_status(p_rule uuid, p_status text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare r coupon_rules; nxt timestamptz;
begin
  perform public.require_role('MASTER');
  select * into r from coupon_rules where id = p_rule for update;
  if not found then raise exception '없는 규칙입니다' using errcode = 'P0002'; end if;
  perform public._coupon_guard_brand(r.brand_id);
  if not ((r.status in ('draft', 'paused') and p_status = 'active') or (r.status = 'active' and p_status = 'paused')
          or (r.status <> 'archived' and p_status = 'archived')) then
    raise exception '% 에서 % 로 바꿀 수 없습니다', r.status, p_status using errcode = '22023';
  end if;
  if p_status = 'active' then
    perform public._coupon_check_rule(r);
    nxt := public.coupon_next_run(r.schedule, now());
    if nxt is null then raise exception '종료일이 지나 다음 실행이 없습니다' using errcode = '22023'; end if;
  end if;
  update coupon_rules set status = p_status, next_run_at = nxt, updated_by = auth.uid(), updated_at = now() where id = p_rule;
  perform public._coupon_audit('rule_' || p_status, p_rule, null, jsonb_build_object('from', r.status, 'next_run_at', nxt));
  return nxt;
end $$;

--  미리보기(직원). 규칙 내용(저장 전 화면 값)을 받아 지금(KST 오늘) 돌리면 몇 명인지.
create or replace function public.coupon_preview(p_rule jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Seoul')::date; res jsonb;
begin
  perform public.require_role('MASTER', 'STAFF');
  perform public._coupon_guard_rule_input(p_rule);
  with t as (select * from public._coupon_targets(p_rule, d))
  select jsonb_build_object(
    'as_of', d,
    'matched', (select count(*) from t),
    'treat', (select count(*) from t where exclude_reason is null and arm = 'treat'),
    'control', (select count(*) from t where exclude_reason is null and arm = 'control'),
    'excluded', (select count(*) from t where exclude_reason is not null),
    'reasons', coalesce((select jsonb_object_agg(exclude_reason, n) from (select exclude_reason, count(*) n from t where exclude_reason is not null group by 1) x), '{}'::jsonb),
    'sample', coalesce((select jsonb_agg(jsonb_build_object('name', public.coupon_mask_name(name), 'id_tail', right(member_id, 3),
                                   'last_date', last_date, 'gone_days', gone_days) order by gone_days desc, member_id)
                          from (select * from t where exclude_reason is null and arm = 'treat' order by gone_days desc, member_id limit 10) y), '[]'::jsonb),
    'max_exposure', (select count(*) from t where exclude_reason is null and arm = 'treat') * nullif(p_rule->'coupon'->>'max_discount', '')::numeric,
    'over_limit', (select count(*) from t where exclude_reason is null and arm = 'treat') > coalesce((p_rule->>'max_targets')::int, 500)
  ) into res;
  return res;
end $$;

-- ============================================================
-- 5-1) 대상 조회(직원, 브랜드 권한) — 기획 4-3 의 repurchase_targets 와 CRM 탭 숫자.
--      둘 다 위 _coupon_member_stats(KST) + coupon_target_match 를 그대로 쓴다 → CRM 휴면90 = 휴면90 규칙 미리보기 '제외 전' 수.
-- ============================================================
create or replace function public.repurchase_targets(p_rule jsonb, p_as_of date default null)
returns table (member_id text, mall_key text, gone_days int, orders int, spend numeric, segment text, arm text, exclude_reason text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_role('MASTER', 'STAFF');
  perform public._coupon_guard_rule_input(p_rule);
  return query
  select t.member_id, t.mall_key, t.gone_days, t.orders, t.spend, coalesce(nullif(p_rule->'target'->>'preset', ''), 'custom'), t.arm, t.exclude_reason
    from public._coupon_targets(p_rule, coalesce(p_as_of, (now() at time zone 'Asia/Seoul')::date)) t
   order by t.gone_days desc, t.member_id;
end $$;

--  CRM 탭(고객 > 대상 명단): 묶음 4개 명단 + 지난달 말 묶음의 복귀율. 화면은 이 결과를 그대로 그린다(JS 계산 없음).
--  복귀 = 지난달 말일(KST) 묶음 회원 중 그 뒤 유효 주문이 있는 사람. 회원 ID·이름·날짜·금액만(전화·이메일 없음).
create or replace function public.repurchase_segments(p_brand uuid, p_as_of date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_as_of, (now() at time zone 'Asia/Seoul')::date);
  pe date := (date_trunc('month', d) - interval '1 day')::date; res jsonb;
begin
  perform public.require_role('MASTER', 'STAFF');
  perform public._coupon_guard_brand(p_brand);
  with cur as (select * from public._coupon_member_stats(p_brand, d)),
  old as (select * from public._coupon_member_stats(p_brand, pe)),
  seg(k, preset) as (values ('first30', 'first30'), ('dormant90', 'dormant90'), ('dormant180', 'dormant180'), ('vipRisk', 'vip_risk'))
  select jsonb_build_object(
    'as_of', d, 'previous_month_end', pe,
    'latest_order', (select max(c.last_date) from cur c),
    'customers', (select count(*) from cur),
    'segments', (select jsonb_object_agg(seg.k, coalesce((
        select jsonb_agg(jsonb_build_object('member_id', c.member_id, 'name', coalesce(c.name, ''), 'first', c.first_date, 'last', c.last_date,
                                            'spend', c.spend, 'orders', c.orders, 'gone_days', c.gone_days, 'avg_cycle', c.avg_cycle)
                         order by c.gone_days desc, c.spend desc, c.member_id)
          from cur c where public.coupon_target_match(jsonb_build_object('preset', seg.preset), c.gone_days, c.orders, c.spend, c.vip, c.avg_cycle)
      ), '[]'::jsonb)) from seg),
    'return_rates', (select jsonb_object_agg(seg.k, (
        select jsonb_build_object('base', count(*), 'returned', count(*) filter (where c.last_date > pe),
                                  'rate', case when count(*) > 0 then round(count(*) filter (where c.last_date > pe) * 1000.0 / count(*)) / 10 else 0 end)
          from old o left join cur c on c.member_id = o.member_id
         where public.coupon_target_match(jsonb_build_object('preset', seg.preset), o.gone_days, o.orders, o.spend, o.vip, o.avg_cycle)
      )) from seg)
  ) into res;
  return res;
end $$;

-- ============================================================
-- 6) 회차 생성기 — pg_cron 이 10분마다. 쿠폰을 발급하지 않는다(DB 안에서 끝).
--    놓친 회차는 1개만, (규칙, 예정 시각) 유니크로 두 번 돌아도 1개. 승인 대기 48시간 → 만료, CSV 뒤 7일 미확인 → export_expired.
-- ============================================================
create or replace function public.coupon_runs_tick(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare r coupon_rules; v_run uuid; d date := (p_now at time zone 'Asia/Seoul')::date; made int := 0; ex1 int; ex2 int;
  tn int; cn int; xn int; mn int;
begin
  for r in select * from coupon_rules where status = 'active' and next_run_at is not null and next_run_at <= p_now
           order by priority, id for update skip locked loop
    insert into coupon_runs (rule_id, rule_version, rule_snapshot, scheduled_for, as_of_date)
      values (r.id, r.version, to_jsonb(r), r.next_run_at, d)
      on conflict (rule_id, scheduled_for) do nothing returning id into v_run;
    if v_run is not null then
      insert into coupon_run_members (run_id, member_id, mall_key, name_masked, last_date, gone_days, orders, spend, arm, status, exclude_reason)
      select v_run, t.member_id, t.mall_key, public.coupon_mask_name(t.name), t.last_date, t.gone_days, t.orders, t.spend,
             t.arm, case when t.exclude_reason is not null then 'excluded' when t.arm = 'control' then 'control' else 'pending' end, t.exclude_reason
        from public._coupon_targets(to_jsonb(r), d) t;
      select count(*) filter (where status = 'pending'), count(*) filter (where status = 'control'), count(*) filter (where status = 'excluded'), count(*)
        into tn, cn, xn, mn from coupon_run_members where coupon_run_members.run_id = v_run;
      update coupon_runs set target_n = tn, control_n = cn, excluded_n = xn, matched_n = mn,
             exclude_counts = coalesce((select jsonb_object_agg(exclude_reason, n) from (select exclude_reason, count(*) n from coupon_run_members m
                                         where m.run_id = coupon_runs.id and m.status = 'excluded' group by 1) x), '{}'::jsonb),
             max_discount_exposure = tn * nullif(r.coupon->>'max_discount', '')::numeric,
             status = case when tn > r.max_targets then 'needs_review' else 'awaiting_approval' end
       where id = v_run;
      perform public._coupon_audit('run_create', r.id, v_run, jsonb_build_object('scheduled_for', r.next_run_at, 'treat', tn, 'control', cn, 'excluded', xn));
      made := made + 1;
    end if;
    update coupon_rules set next_run_at = public.coupon_next_run(r.schedule, greatest(p_now, r.next_run_at)) where id = r.id;
  end loop;

  with x as (update coupon_runs set status = 'expired', finished_at = p_now
              where status in ('awaiting_approval', 'needs_review') and created_at < p_now - interval '48 hours' returning id, rule_id)
  select count(*) into ex1 from (select public._coupon_audit('run_expire', x.rule_id, x.id, '{}'::jsonb) from x) y;

  with x as (update coupon_runs set status = 'export_expired'
              where status = 'exported' and exported_at < p_now - interval '7 days' returning id, rule_id),
       m as (update coupon_run_members set status = 'not_confirmed' where run_id in (select id from x) and status = 'pending' returning 1)
  select count(*) into ex2 from (select public._coupon_audit('export_expire', x.rule_id, x.id, jsonb_build_object('not_confirmed', (select count(*) from m))) from x) y;

  return jsonb_build_object('created', made, 'expired', ex1, 'export_expired', ex2);
end $$;

-- ============================================================
-- 7) 회차 RPC(MASTER) — 승인 · 거절 · 중지 · CSV · 수동 업로드 확인
-- ============================================================
create or replace function public._coupon_run_lock(p_run uuid)
returns public.coupon_runs language plpgsql security definer set search_path = public as $$
declare x coupon_runs;
begin
  select * into x from coupon_runs where id = p_run for update;
  if not found then raise exception '없는 회차입니다' using errcode = 'P0002'; end if;
  perform public._coupon_guard_brand((select brand_id from coupon_rules where id = x.rule_id));
  return x;
end $$;

--  승인 = '내보내기 승인'(1-A). 발송군 인원을 다시 입력해야 한다. 발급 아님.
create or replace function public.coupon_run_approve(p_run uuid, p_confirm_n int)
returns text language plpgsql security definer set search_path = public as $$
declare x coupon_runs;
begin
  perform public.require_role('MASTER');
  x := public._coupon_run_lock(p_run);
  if x.status = 'needs_review' then raise exception '최대 인원(%)을 넘은 회차는 승인할 수 없습니다 — 규칙을 확인하고 거절하세요', x.rule_snapshot->>'max_targets' using errcode = '22023'; end if;
  if x.status <> 'awaiting_approval' then raise exception '승인 대기 회차가 아닙니다(지금: %)', x.status using errcode = '22023'; end if;
  if p_confirm_n is distinct from x.target_n then raise exception '인원 숫자가 다릅니다 — 발송군 %명을 그대로 입력하세요', x.target_n using errcode = '22023'; end if;
  update coupon_runs set status = 'approved_for_export', approved_by = auth.uid(), approved_at = now() where id = p_run;
  perform public._coupon_audit('run_approve', x.rule_id, p_run, jsonb_build_object('treat', x.target_n, 'mode', 'export'));
  return 'approved_for_export';
end $$;

create or replace function public.coupon_run_reject(p_run uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare x coupon_runs;
begin
  perform public.require_role('MASTER');
  if coalesce(btrim(p_reason), '') = '' then raise exception '거절 사유를 넣어 주세요' using errcode = '22023'; end if;
  x := public._coupon_run_lock(p_run);
  if x.status not in ('awaiting_approval', 'needs_review') then raise exception '승인 대기 회차가 아닙니다(지금: %)', x.status using errcode = '22023'; end if;
  update coupon_runs set status = 'rejected', rejected_reason = btrim(p_reason), finished_at = now() where id = p_run;
  perform public._coupon_audit('run_reject', x.rule_id, p_run, jsonb_build_object('reason', btrim(p_reason)));
  return 'rejected';
end $$;

--  회차 중지(1-A): 확인 전 회차를 닫는다. 발송군 pending → cancelled. 이미 카페24에 올렸다면 중지 말고 [업로드 완료 확인].
create or replace function public.coupon_run_cancel(p_run uuid, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare x coupon_runs;
begin
  perform public.require_role('MASTER');
  if coalesce(btrim(p_reason), '') = '' then raise exception '중지 사유를 넣어 주세요' using errcode = '22023'; end if;
  x := public._coupon_run_lock(p_run);
  if x.status not in ('awaiting_approval', 'needs_review', 'approved_for_export', 'exported') then
    raise exception '중지할 수 없는 회차입니다(지금: %)', x.status using errcode = '22023';
  end if;
  update coupon_run_members set status = 'cancelled' where run_id = p_run and status = 'pending';
  update coupon_runs set status = 'cancelled', last_error = btrim(p_reason), finished_at = now() where id = p_run;
  perform public._coupon_audit('run_cancel', x.rule_id, p_run, jsonb_build_object('reason', btrim(p_reason), 'from', x.status));
  return 'cancelled';
end $$;

--  CSV 받기: 발송군 회원 ID 만. 상태 exported(처음 받은 시각 고정). issued 를 만들지 않는다.
create or replace function public.coupon_run_export(p_run uuid)
returns table (member_id text) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare x coupon_runs; n int;
begin
  perform public.require_role('MASTER');
  x := public._coupon_run_lock(p_run);
  if x.status not in ('approved_for_export', 'exported') then raise exception '승인한 회차만 CSV를 받을 수 있습니다(지금: %)', x.status using errcode = '22023'; end if;
  select count(*) into n from coupon_run_members m where m.run_id = p_run and m.arm = 'treat' and m.status = 'pending';
  update coupon_runs set status = 'exported', exported_by = coalesce(exported_by, auth.uid()), exported_at = coalesce(exported_at, now()) where id = p_run;
  perform public._coupon_audit('csv_download', x.rule_id, p_run, jsonb_build_object('rows', n, 'first', x.exported_at is null));
  return query select m.member_id from coupon_run_members m where m.run_id = p_run and m.arm = 'treat' and m.status = 'pending' order by m.member_id;
end $$;

--  수동 업로드 완료 확인 — 1-A 에서 issued 를 만드는 유일한 길(4-0).
--  담당·업로드 시각(미래 불가, CSV 받은 뒤)·카페24 건수·증빙 필수. 건수 = CSV 인원 → 전원. 다르면 회원 목록이 있어야 그 회원만.
--  확정 순간 같은 회차 대조군 → control_counted(같은 쿨다운). 만료(export_expired) 뒤에도 같은 절차로 확정 가능(감사에 표시).
create or replace function public.coupon_run_confirm_manual(p_run uuid, p_owner text, p_uploaded_at timestamptz, p_reported_n int,
                                                            p_evidence_path text, p_member_ids text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x coupon_runs; csv_n int; hit int; miss int; unknown_n int; st text; mode text;
  ev text := btrim(coalesce(p_evidence_path, '')); obj text;
begin
  perform public.require_role('MASTER');
  x := public._coupon_run_lock(p_run);
  if x.status not in ('exported', 'export_expired') then raise exception 'CSV를 받은 회차만 확인할 수 있습니다(지금: %)', x.status using errcode = '22023'; end if;
  if coalesce(btrim(p_owner), '') = '' then raise exception '담당자를 넣어 주세요' using errcode = '22023'; end if;
  if ev = '' then raise exception '증빙(카페24 발급 내역 캡처 또는 결과 파일)이 필요합니다' using errcode = '22023'; end if;
  --  증빙은 이 회차 폴더(coupon_evidence/<회차id>/<파일>)에 확인하는 본인이 CSV 받은 뒤 올린 실제 파일이어야 한다
  obj := regexp_replace(ev, '^coupon_evidence/', '');
  if split_part(obj, '/', 1) <> p_run::text or obj !~ '^[^/]+/[^/]+$' then
    raise exception '증빙 경로가 이 회차 것이 아닙니다(coupon_evidence/%/파일)', p_run using errcode = '22023';
  end if;
  if to_regclass('storage.objects') is null then raise exception '증빙 저장소(storage)가 없습니다' using errcode = '55000'; end if;
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'coupon_evidence' and o.name = obj
                    and coalesce(o.owner_id, o.owner::text) = auth.uid()::text
                    and o.created_at >= x.exported_at - interval '1 minute') then
    raise exception '증빙 파일을 찾지 못했습니다 — 이 화면에서 파일을 올린 뒤 확인하세요' using errcode = '22023';
  end if;
  ev := 'coupon_evidence/' || obj;
  if p_uploaded_at is null or p_uploaded_at > now() + interval '1 minute' then raise exception '업로드 시각이 비었거나 미래입니다' using errcode = '22023'; end if;
  if p_uploaded_at < x.exported_at - interval '1 minute' then raise exception '업로드 시각이 CSV 받은 시각보다 앞섭니다' using errcode = '22023'; end if;
  if p_reported_n is null or p_reported_n < 0 then raise exception '카페24 발급 건수를 넣어 주세요' using errcode = '22023'; end if;
  select count(*) into csv_n from coupon_run_members m where m.run_id = p_run and m.arm = 'treat' and m.status in ('pending', 'not_confirmed');

  if p_member_ids is null then
    if p_reported_n <> csv_n then
      raise exception '카페24 건수(%)가 CSV 인원(%)과 다릅니다 — 카페24 발급 결과의 회원 ID 목록 파일을 올려 주세요', p_reported_n, csv_n using errcode = '22023';
    end if;
    update coupon_run_members set status = 'issued', issue_path = 'manual_upload', issued_at = p_uploaded_at
     where run_id = p_run and arm = 'treat' and status in ('pending', 'not_confirmed');
    get diagnostics hit = row_count; miss := 0; unknown_n := 0; mode := 'all';
  else
    update coupon_run_members set status = 'issued', issue_path = 'manual_upload', issued_at = p_uploaded_at
     where run_id = p_run and arm = 'treat' and status in ('pending', 'not_confirmed')
       and member_id in (select btrim(u) from unnest(p_member_ids) u);
    get diagnostics hit = row_count;
    if hit = 0 then raise exception '올린 목록에 이 회차 발송군 회원이 한 명도 없습니다' using errcode = '22023'; end if;
    update coupon_run_members set status = 'failed', last_error = 'manual_missing'
     where run_id = p_run and arm = 'treat' and status in ('pending', 'not_confirmed');
    get diagnostics miss = row_count;
    select count(*) into unknown_n from (select distinct btrim(u) id from unnest(p_member_ids) u) l
     where not exists (select 1 from coupon_run_members m where m.run_id = p_run and m.arm = 'treat' and m.member_id = l.id);
    mode := 'list';
  end if;

  update coupon_run_members set status = 'control_counted', issued_at = p_uploaded_at where run_id = p_run and status = 'control';
  st := case when miss = 0 then 'done' else 'partial' end;
  update coupon_runs set status = st, issue_path = 'manual_upload', manual_owner = btrim(p_owner), manual_confirmed_by = auth.uid(),
         manual_uploaded_at = p_uploaded_at, manual_reported_n = p_reported_n, manual_evidence_path = ev,
         manual_confirmed_at = now(), finished_at = now() where id = p_run;
  perform public._coupon_audit('manual_confirm', x.rule_id, p_run, jsonb_build_object(
    'owner', btrim(p_owner), 'uploaded_at', p_uploaded_at, 'reported_n', p_reported_n, 'csv_n', csv_n,
    'evidence', ev, 'mode', mode, 'issued', hit, 'missing', miss, 'unknown_ids', unknown_n,
    'after_expiry', x.status = 'export_expired'));
  return jsonb_build_object('status', st, 'issued', hit, 'failed', miss, 'unknown_ids', unknown_n);
end $$;

-- ============================================================
-- 8) 성과(골격) — 회차별 발송군 vs 대조군 복귀율. 복귀 = 확정 시각 뒤 (쿠폰 기간 + 7일) 안 유효 주문.
--    '효과 있음'은 회차 4번 이상 같은 방향일 때만(화면 문구). 여기선 숫자만.
-- ============================================================
create or replace function public.coupon_run_results(p_rule uuid)
returns table (run_id uuid, scheduled_for timestamptz, status text, treat_n int, issued_n int, control_n int,
               treat_returned int, control_returned int, window_days int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.require_role('MASTER', 'STAFF');
  perform public._coupon_guard_brand((select brand_id from coupon_rules where id = p_rule));
  return query
  with r as (select cr.*, coalesce((cr.rule_snapshot->'coupon'->>'valid_days')::int, 7) + 7 w,
                    (cr.rule_snapshot->>'brand_id')::uuid bid from coupon_runs cr where cr.rule_id = p_rule),
  m as (
    select r.id rid, m.member_id, m.status, m.issued_at, r.w, r.bid from r join coupon_run_members m on m.run_id = r.id
     where m.status in ('issued', 'control_counted')
  ), ret as (
    select m.rid, m.status, m.member_id,
           exists (select 1 from channel_orders co join malls ml on ml.mall_key = co.mall_key
                    where ml.brand_id = m.bid
                      and btrim(coalesce(nullif(btrim(co.raw->>'member_id'), ''), co.raw->>'loginId')) = m.member_id
                      and lower(coalesce(co.op_status, '')) not in ('cancel', 'return')
                      and co.order_date > m.issued_at and co.order_date <= m.issued_at + make_interval(days => m.w)) back
      from m
  )
  select r.id, r.scheduled_for, r.status, r.target_n,
         (select count(*)::int from ret where ret.rid = r.id and ret.status = 'issued'),
         r.control_n,
         (select count(*)::int from ret where ret.rid = r.id and ret.status = 'issued' and ret.back),
         (select count(*)::int from ret where ret.rid = r.id and ret.status = 'control_counted' and ret.back),
         r.w
    from r order by r.scheduled_for desc;
end $$;

-- ============================================================
-- 9) 권한 — 내부 함수는 아무도 직접 못 부른다. RPC 는 로그인 사용자(안에서 역할 검사). 생성기는 cron(postgres)만.
-- ============================================================
revoke all on function public._coupon_member_stats(uuid, date) from public, anon, authenticated;
revoke all on function public._coupon_targets(jsonb, date) from public, anon, authenticated;
revoke all on function public._coupon_audit(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._coupon_run_lock(uuid) from public, anon, authenticated;
revoke all on function public._coupon_guard_brand(uuid) from public, anon, authenticated;
revoke all on function public._coupon_guard_rule_input(jsonb) from public, anon, authenticated;
revoke all on function public._coupon_brand_ok(uuid) from public, anon;
grant execute on function public._coupon_brand_ok(uuid) to authenticated;      -- RLS 정책이 부른다(참/거짓만 돌려줌)
revoke all on function public.repurchase_targets(jsonb, date) from public, anon;
revoke all on function public.repurchase_segments(uuid, date) from public, anon;
revoke all on function public.coupon_runs_tick(timestamptz) from public, anon, authenticated;
revoke all on function public.coupon_rule_save(jsonb) from public, anon;
revoke all on function public.coupon_rule_set_status(uuid, text) from public, anon;
revoke all on function public.coupon_preview(jsonb) from public, anon;
revoke all on function public.coupon_run_approve(uuid, int) from public, anon;
revoke all on function public.coupon_run_reject(uuid, text) from public, anon;
revoke all on function public.coupon_run_cancel(uuid, text) from public, anon;
revoke all on function public.coupon_run_export(uuid) from public, anon;
revoke all on function public.coupon_run_confirm_manual(uuid, text, timestamptz, int, text, text[]) from public, anon;
revoke all on function public.coupon_run_results(uuid) from public, anon;
grant execute on function public.coupon_rule_save(jsonb), public.coupon_rule_set_status(uuid, text), public.coupon_preview(jsonb),
  public.coupon_run_approve(uuid, int), public.coupon_run_reject(uuid, text), public.coupon_run_cancel(uuid, text),
  public.coupon_run_export(uuid), public.coupon_run_confirm_manual(uuid, text, timestamptz, int, text, text[]),
  public.coupon_run_results(uuid), public.repurchase_targets(jsonb, date), public.repurchase_segments(uuid, date) to authenticated;

-- ============================================================
-- 10) 증빙 버킷(비공개) — 경로 = <회차id>/<파일>. 읽기: 그 회차 브랜드 권한 있는 직원. 올리기: MASTER, CSV 받은 회차 폴더에만.
--     지우기·덮어쓰기 없음(감사 증빙). 수동 확인 RPC 가 파일 실재·올린 사람을 다시 확인한다.
-- ============================================================
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('coupon_evidence', 'coupon_evidence', false, 10485760,
            array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/csv', 'text/plain',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    drop policy if exists coupon_evidence_select on storage.objects;
    drop policy if exists coupon_evidence_insert on storage.objects;
    create policy coupon_evidence_select on storage.objects for select to authenticated
      using (bucket_id = 'coupon_evidence' and public.is_staff()
             and exists (select 1 from public.coupon_runs x join public.coupon_rules r on r.id = x.rule_id
                          where x.id::text = split_part(storage.objects.name, '/', 1) and public._coupon_brand_ok(r.brand_id)));
    create policy coupon_evidence_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'coupon_evidence' and public.is_master() and name ~ '^[^/]+/[^/]+$'
                  and exists (select 1 from public.coupon_runs x join public.coupon_rules r on r.id = x.rule_id
                               where x.id::text = split_part(storage.objects.name, '/', 1) and x.status in ('exported', 'export_expired')
                                 and public._coupon_brand_ok(r.brand_id)));
  end if;
end $$;

-- ============================================================
-- 11) 10분마다 회차 생성기 — DB 안 함수만 부른다(외부 호출·비밀값 없음). pg_cron 이 없으면 건너뜀.
-- ============================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coupon-runs-tick';
    perform cron.schedule('coupon-runs-tick', '*/10 * * * *', 'select public.coupon_runs_tick()');
  end if;
end $$;

select '103 repurchase coupon 1-A installed' as status;
