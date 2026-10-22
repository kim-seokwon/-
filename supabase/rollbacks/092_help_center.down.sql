-- 092 되돌리기 — 도움말 센터 표·정책·버킷을 걷는다.
-- ⚠ 공지·불편접수 내용과 첨부가 함께 사라진다. 지우기 전에 필요하면 백업:
--   select * from notices; select * from feedback_reports;  · 첨부는 Storage 화면에서 feedback 버킷 내려받기
-- is_staff()(087)·is_master() 는 남긴다 — 091 사용 기록(운영 적용됨) 정책이 is_master 를 쓴다.

drop policy if exists feedback_obj_insert on storage.objects;
drop policy if exists feedback_obj_select on storage.objects;
drop policy if exists feedback_obj_delete on storage.objects;
-- 버킷은 안에 파일이 있으면 지워지지 않는다 — 비운 뒤 지운다(파일이 남아 있으면 이 줄에서 멈춤 = 의도)
delete from storage.buckets where id = 'feedback';

drop table if exists public.feedback_reports;
drop table if exists public.notice_reads;
drop table if exists public.notices;
