-- 샘플·제작을 한 단계로 합치고, 그 단계는 메모가 아니라 '제품리스트에 제품을 올리는 일' 로 둔다.
--  이유: 샘플과 제작은 같은 제품을 두 번 적게 만들고, 실제 기록은 제품리스트(product_items)에 쌓인다.
--  kind = 'items' 인 단계는 메모를 만들지 않고 제품리스트로 보낸다.
alter table season_steps add column if not exists kind text not null default 'note';
alter table season_steps drop constraint if exists season_steps_kind_chk;
alter table season_steps add constraint season_steps_kind_chk check (kind in ('note','items'));

-- 기존 '샘플' 을 '샘플·제작' 으로 바꾸고 제작의 할 일을 합친다
update season_steps
   set name = '샘플·제작',
       kind = 'items',
       offset_days = -60,
       icon = 'ph-t-shirt',
       color = '#bf5af2',
       checklist = array['원단 확정','샘플 발주','샘플 검토','수정 요청',
                         '작업지시서 작성','원부자재 발주','생산 투입','검품']
 where brand_id is null and name = '샘플';

delete from season_steps where brand_id is null and name = '제작';

select name, kind, offset_days, sort from season_steps order by sort;
