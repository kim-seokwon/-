-- 115 광고 판정판 브랜드 하드코딩 제거 (전체점검-1117 ⑥)
--   세트명 접두사(브랜드 연결이 빈 광고를 찾는 단서)와 판정판 브랜드 순서를 코드(adPanel.js PREFIX·rank)에서
--   브랜드별 판정선 행(ad_report_rules)으로 옮긴다. 새 고객 브랜드는 행만 넣으면 된다.
--   되돌리기: supabase/rollbacks/115_ad_prefixes.down.sql (이 마이그레이션이 만든 열만 지운다)
--
--   가드
--   · 소유 표식: 열을 '여기서 새로 만들 때만' 열 주석 'mig115' 를 단다. down 은 이 표식이 있는 열만 지운다.
--   · 최초 1회 seed: 열을 새로 만든 그 트랜잭션에서만 옛 코드 값을 채운다. 다시 돌리면 seed 를 건너뛴다
--     → 일부러 {} 로 비운 값·배포 뒤 바꾼 설정을 덮지 않는다(재실행해도 아무 값도 안 바뀜).
--   · 범위: 이일칠구 org(…2179) 브랜드만. 다른 조직의 동명 브랜드에는 넣지 않는다.
do $m$
declare
  ilchilgu constant uuid := '00000000-0000-4000-8000-000000002179';
  new_pf boolean := false;
  new_so boolean := false;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'brands' and column_name = 'org_id') then
    raise exception '115 중단 — brands.org_id 없음(113 먼저 적용)';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ad_report_rules' and column_name = 'ad_prefixes') then
    alter table public.ad_report_rules add column ad_prefixes text[] not null default '{}';
    comment on column public.ad_report_rules.ad_prefixes is 'mig115: 광고 세트명 접두사(브랜드 연결이 빈 광고 판정용)';
    new_pf := true;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ad_report_rules' and column_name = 'sort_order') then
    alter table public.ad_report_rules add column sort_order integer;
    comment on column public.ad_report_rules.sort_order is 'mig115: 광고 판정판 브랜드 순서(작을수록 위)';
    new_so := true;
  end if;

  -- 옛 코드(adPanel.js PREFIX·rank)에 박혀 있던 값 — 열을 방금 만든 경우에만, 이일칠구 브랜드에만
  if new_pf or new_so then
    update public.ad_report_rules r
       set ad_prefixes = case when new_pf then v.prefixes else r.ad_prefixes end,
           sort_order  = case when new_so then v.ord      else r.sort_order  end
      from public.brands b
      join (values ('하이헤이호', array['hhh', '하헤호'], 1),
                   ('로하이스튜디오', array['lohi'], 2),
                   ('토비', array['tovee'], 3)) v(name, prefixes, ord) on v.name = b.name
     where r.brand_id = b.id and b.org_id = ilchilgu;
  end if;
end $m$;
