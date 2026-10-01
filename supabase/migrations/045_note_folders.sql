-- ============================================
-- 메모 폴더에도 접근 권한 — 마스터가 '이 폴더는 누구누구만' 을 정한다
--
-- 지금까지 메모 폴더는 notes.folder 라는 글자일 뿐이라 권한이 없었다.
-- 폴더마다 전체공개/지정한 사람만 을 두고, 메모 보기 정책이 그걸 함께 본다.
-- ============================================

CREATE TABLE IF NOT EXISTS note_folders (
  name       TEXT PRIMARY KEY,
  access     TEXT NOT NULL DEFAULT 'all' CHECK (access IN ('all','members')),
  members    TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE note_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nf_select ON note_folders;
DROP POLICY IF EXISTS nf_write  ON note_folders;
-- 잠긴 폴더는 권한 없는 계정에겐 **있는지조차 안 보인다**(이름도 흘리지 않는다)
CREATE POLICY nf_select ON note_folders FOR SELECT TO authenticated
  USING (get_user_role() = 'MASTER' OR access = 'all' OR current_username() = ANY(members));
-- 정하는 건 마스터만
CREATE POLICY nf_write ON note_folders FOR ALL TO authenticated
  USING (get_user_role() = 'MASTER') WITH CHECK (get_user_role() = 'MASTER');

-- 폴더 권한 확인 — 정해진 게 없으면 열려 있다
-- SECURITY DEFINER 여야 한다 — 폴더 행 자체를 가렸기 때문에,
-- 그냥 두면 이 함수도 그 행을 못 봐서 '잠긴 폴더가 없다' 고 판단해 버린다.
CREATE OR REPLACE FUNCTION can_see_folder(p_folder TEXT)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case
    when p_folder is null then true
    when get_user_role() = 'MASTER' then true
    else not exists (
      select 1 from note_folders f
       where f.name = p_folder
         and f.access = 'members'
         and not (public.current_username() = any(f.members))
    )
  end
$$;
REVOKE ALL ON FUNCTION can_see_folder(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_see_folder(TEXT) TO authenticated;

-- 메모 보기 정책이 폴더 권한도 같이 본다
DROP POLICY IF EXISTS notes_select ON notes;
CREATE POLICY notes_select ON notes FOR SELECT TO authenticated
  USING (can_see_note(scope, owner, product_id, brand_id) AND can_see_folder(folder));

SELECT '메모 폴더 권한 설치됨' AS status;
