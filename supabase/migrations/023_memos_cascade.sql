-- ============================================================
--  프로젝트(products) 삭제가 memos 때문에 막히던 문제
--  같은 프로젝트 하위 데이터인 product_stages/history/todos/photos/documents 는 전부 CASCADE 인데
--  memos 만 NO ACTION 이라, 메모가 하나라도 달린 프로젝트는 삭제가 안 되고
--  그 프로젝트를 가진 계정도 삭제할 수 없었다(계정 삭제 → products CASCADE → memos 에서 막힘).
--  메모는 프로젝트에 종속된 내용이므로 다른 하위 테이블과 동일하게 CASCADE.
-- ============================================================
alter table memos drop constraint if exists memos_product_id_fkey;
alter table memos add  constraint memos_product_id_fkey
  foreign key (product_id) references products(id) on delete cascade;
