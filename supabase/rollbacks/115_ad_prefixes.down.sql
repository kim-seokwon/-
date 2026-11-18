-- 115 되돌리기 — 115 가 만든 열(열 주석이 'mig115:' 로 시작)만 지운다.
--   열이 없으면 그냥 지나가고, 표식이 없으면(115 전에 따로 있던 열) 건드리지 않는다.
--   ⚠ 프런트(adPanel.js)가 이 열을 읽으므로 화면을 115 전 코드로 되돌린 뒤에 실행한다.
do $d$
declare c text;
begin
  foreach c in array array['ad_prefixes', 'sort_order'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'ad_report_rules' and column_name = c) then
      raise notice '115-down: ad_report_rules.% 없음 — 건너뜀', c;
    elsif coalesce(col_description('public.ad_report_rules'::regclass,
            (select attnum from pg_attribute where attrelid = 'public.ad_report_rules'::regclass and attname = c)), '') like 'mig115:%' then
      execute format('alter table public.ad_report_rules drop column if exists %I', c);
    else
      raise notice '115-down: ad_report_rules.% 은 115 표식이 없음 — 남김', c;
    end if;
  end loop;
end $d$;
