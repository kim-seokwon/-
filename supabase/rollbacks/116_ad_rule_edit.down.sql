-- 116 되돌리기 — 116 이 만든 함수·로그표만 지운다. ad_report_rules 값은 건드리지 않는다.
--   판정선 값을 옛값으로 돌리려면 먼저 로그를 보고(아래 주석 SQL) 손으로 update 한 뒤 이 파일을 돌린다.
--   select brand_id, before, after, changed_email, changed_at from public.ad_report_rule_log order by changed_at desc;
drop function if exists public.set_ad_report_rule(uuid, integer, integer, integer, integer);
do $m$ begin
  if to_regclass('public.ad_report_rule_log') is not null then
    drop policy if exists ad_report_rule_log_org_read on public.ad_report_rule_log;   -- 정책이 아래 함수를 물고 있다
    if coalesce(obj_description(to_regclass('public.ad_report_rule_log'), 'pg_class'), '') like 'mig116:%' then
      drop table public.ad_report_rule_log;
    else
      raise notice '116-down: ad_report_rule_log 에 116 표식 없음 — 남김';
    end if;
  end if;
end $m$;
drop policy if exists ad_report_rules_org_read on public.ad_report_rules;   -- 105 의 _staff_read 는 남는다
drop function if exists public.ad_rule_log_can_read(uuid);
