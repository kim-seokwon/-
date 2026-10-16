-- 083 되돌리기.
drop function if exists public.brand_vip_rank_changes(text, timestamptz, int);
notify pgrst, 'reload schema';
