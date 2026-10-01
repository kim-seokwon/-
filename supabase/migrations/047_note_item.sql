-- ============================================
-- 제품마다 '제품 페이지' — 사진 붙이고 글 쓰는 기록장.
-- 새 표를 만들지 않고 메모를 쓴다. 메모엔 이미 사진 첨부·[ ] 할 일·
-- 속성(상태·날짜·담당자)이 다 붙어 있어서, 제품에 연결만 해 주면 된다.
-- ============================================
ALTER TABLE notes ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES product_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notes_item ON notes(item_id);

SELECT '메모에 제품 연결 칸 추가됨' AS status;
