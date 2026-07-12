-- ============================================
-- BHAS 노션식 워크스페이스 스키마
-- Supabase Dashboard → SQL Editor에서 실행하세요 (001_inventory.sql 이후)
-- 신규 테이블만 추가. 기존 무변경.
-- ============================================

-- ============================================
-- pages : 노션식 자유 노트/위키 (중첩 트리)
-- ============================================
CREATE TABLE IF NOT EXISTS pages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL DEFAULT '제목 없음',
  icon       TEXT DEFAULT '📄',
  parent_id  UUID REFERENCES pages(id) ON DELETE CASCADE,   -- 중첩
  brand_id   UUID REFERENCES brands(id) ON DELETE SET NULL,
  content    TEXT DEFAULT '',          -- 마크다운 본문
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, sort_order);

-- ============================================
-- board_cards : 칸반 카드 (자유 보드)
-- ============================================
CREATE TABLE IF NOT EXISTS board_cards (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  body       TEXT DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'todo',   -- 'todo'|'doing'|'done' (자유 확장)
  brand_id   UUID REFERENCES brands(id) ON DELETE SET NULL,
  assignee   TEXT,
  due_date   DATE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_status ON board_cards(status, sort_order);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pages_touch ON pages;
CREATE TRIGGER trg_pages_touch BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trg_cards_touch ON board_cards;
CREATE TRIGGER trg_cards_touch BEFORE UPDATE ON board_cards
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================
-- RLS (인증 사용자 읽기, MASTER/STAFF 쓰기)
-- ============================================
ALTER TABLE pages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pages_select" ON pages;
DROP POLICY IF EXISTS "pages_write"  ON pages;
DROP POLICY IF EXISTS "pages_update" ON pages;
DROP POLICY IF EXISTS "pages_delete" ON pages;
CREATE POLICY "pages_select" ON pages FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "pages_write"  ON pages FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "pages_update" ON pages FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "pages_delete" ON pages FOR DELETE USING (get_user_role() IN ('MASTER','STAFF'));

DROP POLICY IF EXISTS "cards_select" ON board_cards;
DROP POLICY IF EXISTS "cards_write"  ON board_cards;
DROP POLICY IF EXISTS "cards_update" ON board_cards;
DROP POLICY IF EXISTS "cards_delete" ON board_cards;
CREATE POLICY "cards_select" ON board_cards FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cards_write"  ON board_cards FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "cards_update" ON board_cards FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "cards_delete" ON board_cards FOR DELETE USING (get_user_role() IN ('MASTER','STAFF'));

SELECT 'workspace schema installed' AS status;
