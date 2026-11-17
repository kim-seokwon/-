-- 109 적용 전 건수 미리 보기 — 읽기만(아무것도 바꾸지 않는다). 운영에서 109 를 깔기 전에 팀장이 돌린다.
--   판정식은 109 의 update 와 같다. 적용 뒤 기대값:
--     mobile 칸 채워진 행 = to_mobile, phone 남은 행 = keep_phone, 전체 행 수·빈 번호 행 수는 그대로.
with v as (
  select phone, regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') as d from public.vendors
)
select count(*)                                                                  as total,
       count(*) filter (where nullif(trim(phone), '') is null)                   as no_phone,
       count(*) filter (where phone is not null
                          and (d ~ '^01[016789][0-9]{7,8}$' or d ~ '^821[016789][0-9]{7,8}$')) as to_mobile,
       count(*) filter (where nullif(trim(phone), '') is not null
                          and not (d ~ '^01[016789][0-9]{7,8}$' or d ~ '^821[016789][0-9]{7,8}$')) as keep_phone,
       count(*) filter (where nullif(trim(phone), '') is not null and d ~ '01[016789]'
                          and not (d ~ '^01[016789][0-9]{7,8}$' or d ~ '^821[016789][0-9]{7,8}$')) as keep_mixed_has_mobile
  from v;
-- keep_mixed_has_mobile: 번호가 둘 이상 섞여 휴대폰이 phone 에 남는 행 — 화면에서 손으로 나눌 대상.
