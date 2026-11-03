-- 103 되돌리기 — 재구매 쿠폰 1-A 를 걷는다.
-- 회차 기록이 하나라도 있으면 거절한다(감사·증빙을 지우지 않는다). 기록을 남기고 기능만 멈추려면 규칙을 보관(archived)하고 크론만 끈다.
-- 증빙 버킷(coupon_evidence)은 파일이 있으면 지우지 않는다.
do $$
begin
  if to_regclass('public.coupon_runs') is not null then
    if exists (select 1 from public.coupon_runs) then
      raise exception '103 되돌리기: 회차 기록이 있음 — 지우지 않는다. 규칙 보관 + cron.unschedule(''coupon-runs-tick'') 로 멈출 것';
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coupon-runs-tick';
  end if;
  if to_regclass('storage.objects') is not null then
    drop policy if exists coupon_evidence_select on storage.objects;
    drop policy if exists coupon_evidence_insert on storage.objects;
  end if;
  if to_regclass('storage.buckets') is not null then
    delete from storage.buckets b where b.id = 'coupon_evidence'
      and not exists (select 1 from storage.objects o where o.bucket_id = 'coupon_evidence');
  end if;
end $$;

drop function if exists public.repurchase_segments(uuid, date);
drop function if exists public.repurchase_targets(jsonb, date);
drop function if exists public.coupon_run_results(uuid);
drop function if exists public.coupon_run_confirm_manual(uuid, text, timestamptz, int, text, text[]);
drop function if exists public.coupon_run_export(uuid);
drop function if exists public.coupon_run_cancel(uuid, text);
drop function if exists public.coupon_run_reject(uuid, text);
drop function if exists public.coupon_run_approve(uuid, int);
drop function if exists public._coupon_run_lock(uuid);
drop function if exists public.coupon_runs_tick(timestamptz);
drop function if exists public.coupon_preview(jsonb);
drop function if exists public.coupon_rule_set_status(uuid, text);
drop function if exists public.coupon_rule_save(jsonb);
drop function if exists public._coupon_audit(text, uuid, uuid, jsonb);
drop function if exists public._coupon_targets(jsonb, date);
drop function if exists public.coupon_target_match(jsonb, int, int, numeric, boolean, numeric);
drop function if exists public._coupon_member_stats(uuid, date);
drop function if exists public.coupon_mask_name(text);
drop function if exists public.coupon_bucket(text);
drop function if exists public.coupon_next_run(jsonb, timestamptz);

drop function if exists public._coupon_check_rule(public.coupon_rules);
drop table if exists public.coupon_audit;
drop table if exists public.coupon_run_members;
drop table if exists public.coupon_runs;
drop table if exists public.coupon_rule_versions;
drop table if exists public.coupon_rules;
drop function if exists public._coupon_guard_rule_input(jsonb);
drop function if exists public._coupon_guard_brand(uuid);
drop function if exists public._coupon_brand_ok(uuid);      -- 정책(표·버킷)이 물고 있어서 표·정책 다음에

select '103 repurchase coupon rolled back' as status;
