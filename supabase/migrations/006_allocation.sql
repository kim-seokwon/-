-- ============================================
-- 2179 멀티채널 재고 분배(allocation)
-- 채널별 배정 수량 + 누적 판매. sum(allocated) <= inventory_items.on_hand 권장.
-- Supabase Dashboard → SQL Editor에서 실행 (001~005 이후)
-- ============================================

ALTER TABLE channel_listings ADD COLUMN IF NOT EXISTS allocated INT NOT NULL DEFAULT 0; -- 이 채널 배정 수량
ALTER TABLE channel_listings ADD COLUMN IF NOT EXISTS sold      INT NOT NULL DEFAULT 0; -- 이 채널 누적 판매

-- 품목별 배정 합계 조회 편의 뷰
CREATE OR REPLACE VIEW inventory_allocation AS
SELECT
  i.id                                   AS inventory_item_id,
  i.sku, i.name, i.on_hand,
  COALESCE(SUM(l.allocated), 0)          AS total_allocated,
  i.on_hand - COALESCE(SUM(l.allocated), 0) AS unallocated,
  COUNT(l.id) FILTER (WHERE l.channel_variant_code IS NOT NULL) AS channel_count
FROM inventory_items i
LEFT JOIN channel_listings l ON l.inventory_item_id = i.id
GROUP BY i.id;

SELECT 'allocation schema installed' AS status;
