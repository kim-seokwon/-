-- 115 광고 판정판 브랜드 하드코딩 제거 (전체점검-1117 ⑥)
--   세트명 접두사(브랜드 연결이 빈 광고를 찾는 단서)와 판정판 브랜드 순서를 코드(adPanel.js PREFIX·rank)에서
--   브랜드별 판정선 행(ad_report_rules)으로 옮긴다. 새 고객 브랜드는 행만 넣으면 된다.
--   되돌리기: alter table public.ad_report_rules drop column ad_prefixes, drop column sort_order;
alter table public.ad_report_rules
  add column if not exists ad_prefixes text[] not null default '{}',
  add column if not exists sort_order  integer;

-- 지금 코드에 박혀 있던 값 그대로 옮긴다(이름이 같은 브랜드에만, 이미 채워져 있으면 건드리지 않음)
update public.ad_report_rules r
   set ad_prefixes = v.prefixes, sort_order = coalesce(r.sort_order, v.ord)
  from public.brands b
  join (values ('하이헤이호', array['hhh', '하헤호'], 1),
               ('로하이스튜디오', array['lohi'], 2),
               ('토비', array['tovee'], 3)) v(name, prefixes, ord) on v.name = b.name
 where r.brand_id = b.id and r.ad_prefixes = '{}';
