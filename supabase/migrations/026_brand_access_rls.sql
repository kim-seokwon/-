-- Enforce brand permissions in PostgreSQL, not only in browser filtering.

CREATE OR REPLACE FUNCTION can_access_brand(p_brand_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE p companies%ROWTYPE;
BEGIN
  SELECT * INTO p FROM companies
   WHERE username=split_part(auth.jwt()->>'email','@',1) LIMIT 1;
  IF p.id IS NULL THEN RETURN FALSE; END IF;
  IF p.role='MASTER' THEN RETURN TRUE; END IF;
  IF p.role='STAFF' THEN
    RETURN p.brand_access IS NULL OR cardinality(p.brand_access)=0 OR p_brand_id=ANY(p.brand_access);
  END IF;
  RETURN p_brand_id IS NOT NULL AND (
    p_brand_id=p.brand_id OR
    (p.brand_access IS NOT NULL AND p_brand_id=ANY(p.brand_access))
  );
END;
$$;
REVOKE ALL ON FUNCTION can_access_brand(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_access_brand(UUID) TO authenticated;

DROP POLICY IF EXISTS orders_select ON channel_orders;
CREATE POLICY orders_select ON channel_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM malls m WHERE m.mall_key=channel_orders.mall_key AND can_access_brand(m.brand_id))
);
DROP POLICY IF EXISTS orders_update ON channel_orders;
CREATE POLICY orders_update ON channel_orders FOR UPDATE USING (
  get_user_role() IN ('MASTER','STAFF') AND
  EXISTS (SELECT 1 FROM malls m WHERE m.mall_key=channel_orders.mall_key AND can_access_brand(m.brand_id))
);

DROP POLICY IF EXISTS order_items_select ON channel_order_items;
CREATE POLICY order_items_select ON channel_order_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM channel_orders o WHERE o.id=channel_order_items.channel_order_id)
);

DROP POLICY IF EXISTS malls_select ON malls;
CREATE POLICY malls_select ON malls FOR SELECT USING (can_access_brand(brand_id));

DROP POLICY IF EXISTS inv_items_select ON inventory_items;
CREATE POLICY inv_items_select ON inventory_items FOR SELECT USING (can_access_brand(brand_id));
DROP POLICY IF EXISTS listings_select ON channel_listings;
CREATE POLICY listings_select ON channel_listings FOR SELECT USING (
  EXISTS (SELECT 1 FROM inventory_items i WHERE i.id=channel_listings.inventory_item_id)
);
DROP POLICY IF EXISTS ledger_select ON inventory_ledger;
CREATE POLICY ledger_select ON inventory_ledger FOR SELECT USING (
  EXISTS (SELECT 1 FROM inventory_items i WHERE i.id=inventory_ledger.inventory_item_id)
);

DROP POLICY IF EXISTS companies_select ON companies;
CREATE POLICY companies_select ON companies FOR SELECT USING (
  get_user_role() IN ('MASTER','STAFF') OR id::text=get_user_company_id()::text
);

DROP POLICY IF EXISTS quotes_select ON quotes;
CREATE POLICY quotes_select ON quotes FOR SELECT USING (get_user_role() IN ('MASTER','STAFF'));
DROP POLICY IF EXISTS clients_select ON clients;
CREATE POLICY clients_select ON clients FOR SELECT USING (get_user_role() IN ('MASTER','STAFF'));
DROP POLICY IF EXISTS vendors_select ON vendors;
CREATE POLICY vendors_select ON vendors FOR SELECT USING (get_user_role() IN ('MASTER','STAFF'));
DROP POLICY IF EXISTS vjobs_select ON vendor_jobs;
CREATE POLICY vjobs_select ON vendor_jobs FOR SELECT USING (get_user_role() IN ('MASTER','STAFF'));
DROP POLICY IF EXISTS tech_packs_all ON tech_packs;
DROP POLICY IF EXISTS tech_packs_select ON tech_packs;
DROP POLICY IF EXISTS tech_packs_write ON tech_packs;
CREATE POLICY tech_packs_select ON tech_packs FOR SELECT USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY tech_packs_write ON tech_packs FOR ALL
  USING (get_user_role() IN ('MASTER','STAFF'))
  WITH CHECK (get_user_role() IN ('MASTER','STAFF'));

SELECT 'brand access RLS installed' AS status;
