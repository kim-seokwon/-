-- Operational integrity: idempotent inventory adjustments, shipment jobs and audit trail.

ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS inventory_ledger_reason_check;
ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_reason_check
  CHECK (reason IN (
    'initial','restock','cafe24_order','channel_reconcile',
    'manual','adjust','return'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_idempotency
  ON inventory_ledger(inventory_item_id, reason, ref)
  WHERE ref IS NOT NULL;

-- 원장 입력과 채널 배정/판매 누계를 한 트랜잭션에서 처리한다.
CREATE OR REPLACE FUNCTION apply_channel_inventory_adjustment(
  p_inventory_item_id UUID,
  p_listing_id UUID,
  p_delta INT,
  p_reason TEXT,
  p_ref TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_id UUID;
BEGIN
  IF p_delta = 0 OR p_ref IS NULL OR p_reason NOT IN ('cafe24_order','channel_reconcile') THEN
    RETURN FALSE;
  END IF;

  INSERT INTO inventory_ledger(inventory_item_id, delta, reason, ref, note, created_by)
  VALUES (p_inventory_item_id, p_delta, p_reason, p_ref, p_note, 'channel-sync')
  ON CONFLICT DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN RETURN FALSE; END IF;

  IF p_listing_id IS NOT NULL THEN
    UPDATE channel_listings
       SET allocated = GREATEST(COALESCE(allocated, 0) + p_delta, 0),
           sold = GREATEST(COALESCE(sold, 0) - p_delta, 0)
     WHERE id = p_listing_id;
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION apply_channel_inventory_adjustment(UUID,UUID,INT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_channel_inventory_adjustment(UUID,UUID,INT,TEXT,TEXT,TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS shipment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mall_key TEXT NOT NULL,
  order_id TEXT NOT NULL,
  courier TEXT NOT NULL,
  invoice_no TEXT,
  provider_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','issued','registering','registered','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  issued_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(mall_key, order_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipment_invoice
  ON shipment_jobs(courier, invoice_no) WHERE invoice_no IS NOT NULL;
ALTER TABLE shipment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_jobs_select ON shipment_jobs FOR SELECT
  USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY shipment_jobs_write ON shipment_jobs FOR ALL
  USING (get_user_role() IN ('MASTER','STAFF'))
  WITH CHECK (get_user_role() IN ('MASTER','STAFF'));

CREATE OR REPLACE FUNCTION claim_shipment_job(
  p_mall_key TEXT, p_order_id TEXT, p_courier TEXT, p_actor UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec shipment_jobs%ROWTYPE;
  new_id UUID;
BEGIN
  INSERT INTO shipment_jobs(mall_key, order_id, courier, status, attempts, created_by)
  VALUES (p_mall_key, p_order_id, p_courier, 'pending', 1, p_actor)
  ON CONFLICT (mall_key, order_id) DO NOTHING
  RETURNING id INTO new_id;
  IF new_id IS NOT NULL THEN RETURN TRUE; END IF;

  SELECT * INTO rec FROM shipment_jobs
   WHERE mall_key = p_mall_key AND order_id = p_order_id FOR UPDATE;
  IF rec.invoice_no IS NOT NULL OR rec.status IN ('pending','registering','registered') THEN
    RETURN FALSE;
  END IF;
  UPDATE shipment_jobs SET status='pending', attempts=attempts+1, last_error=NULL,
         updated_at=now(), created_by=COALESCE(created_by,p_actor)
   WHERE id=rec.id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION claim_shipment_job(TEXT,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_shipment_job(TEXT,TEXT,TEXT,UUID) TO service_role;

-- 이미 발급된 송장을 카페24에 등록하는 단계도 원자적으로 선점한다.
-- 같은 주문에 대한 동시 요청은 한 건만 외부 API를 호출할 수 있다.
CREATE OR REPLACE FUNCTION claim_shipment_registration(
  p_mall_key TEXT, p_order_id TEXT, p_invoice_no TEXT, p_courier TEXT, p_actor UUID
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec shipment_jobs%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM shipment_jobs
   WHERE mall_key=p_mall_key AND order_id=p_order_id FOR UPDATE;

  IF rec.id IS NULL THEN
    INSERT INTO shipment_jobs(
      mall_key, order_id, courier, invoice_no, status, attempts, created_by
    ) VALUES (
      p_mall_key, p_order_id, p_courier, p_invoice_no, 'registering', 1, p_actor
    );
    RETURN 'claimed';
  END IF;

  IF rec.invoice_no IS NOT NULL AND rec.invoice_no <> p_invoice_no THEN
    RETURN 'invoice_conflict';
  END IF;
  IF rec.status = 'registered' THEN RETURN 'registered'; END IF;
  IF rec.status = 'registering' THEN RETURN 'busy'; END IF;

  UPDATE shipment_jobs
     SET courier=p_courier, invoice_no=p_invoice_no, status='registering',
         attempts=attempts+1, last_error=NULL, updated_at=now(),
         created_by=COALESCE(created_by,p_actor)
   WHERE id=rec.id;
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION claim_shipment_registration(TEXT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_shipment_registration(TEXT,TEXT,TEXT,TEXT,UUID) TO service_role;

CREATE TABLE IF NOT EXISTS operation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  result TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operation_audit_created ON operation_audit(created_at DESC);
ALTER TABLE operation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY operation_audit_select ON operation_audit FOR SELECT
  USING (get_user_role() = 'MASTER');

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_last_error TEXT;

CREATE OR REPLACE FUNCTION claim_tax_invoice(p_quote_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed UUID;
BEGIN
  UPDATE quotes SET tax_status='issuing', tax_last_error=NULL, updated_at=now()
   WHERE id=p_quote_id AND COALESCE(tax_status,'none') IN ('none','failed')
   RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION claim_tax_invoice(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_tax_invoice(UUID) TO service_role;

CREATE OR REPLACE FUNCTION claim_vendor_quick(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE claimed UUID;
BEGIN
  UPDATE vendor_jobs
     SET quick_status=jsonb_build_object('status','requesting','claimed_at',now())
   WHERE id=p_job_id AND qc_status='passed'
     AND (quick_status IS NULL OR quick_status->>'status'='failed')
   RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION claim_vendor_quick(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_vendor_quick(UUID) TO service_role;

SELECT 'operational integrity installed' AS status;
