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
-- 어떤 폴더가 있고 누가 볼 수 있는지는 로그인한 사람 모두 읽는다(화면에 자물쇠를 그려야 한다)
CREATE POLICY nf_select ON note_folders FOR SELECT TO authenticated USING (true);
-- 정하는 건 마스터만
CREATE POLICY nf_write ON note_folders FOR ALL TO authenticated
  USING (get_user_role() = 'MASTER') WITH CHECK (get_user_role() = 'MASTER');

-- 폴더 권한 확인 — 정해진 게 없으면 열려 있다
CREATE OR REPLACE FUNCTION can_see_folder(p_folder TEXT)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
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
