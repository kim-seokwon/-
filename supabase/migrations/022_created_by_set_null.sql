-- ============================================================
--  계정 삭제가 막히던 문제 수정
--  photos/documents/global_documents.created_by 가 companies 를 NO ACTION 으로 참조해서,
--  그 계정이 사진 한 장이라도 올렸으면 계정을 영영 못 지웠음("연결된 데이터가 있어 삭제할 수 없습니다").
--  created_by 는 '누가 올렸는지' 감사 정보일 뿐이라, 계정이 사라지면 참조만 끊고(SET NULL)
--  사진·문서 자체는 남기는 게 맞다. (세 컬럼 모두 nullable 확인됨)
-- ============================================================
alter table photos            drop constraint if exists photos_created_by_fkey;
alter table photos            add  constraint photos_created_by_fkey
  foreign key (created_by) references companies(id) on delete set null;

alter table documents         drop constraint if exists documents_created_by_fkey;
alter table documents         add  constraint documents_created_by_fkey
  foreign key (created_by) references companies(id) on delete set null;

alter table global_documents  drop constraint if exists global_documents_created_by_fkey;
alter table global_documents  add  constraint global_documents_created_by_fkey
  foreign key (created_by) references companies(id) on delete set null;
