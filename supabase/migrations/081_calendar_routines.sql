-- 캘린더 고정 루틴. 배포/DB 적용은 별도 승인 후 수행한다.

CREATE TABLE IF NOT EXISTS calendar_routines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  kind TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('general','vendor_settlement','subscription')),
  recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('daily','weekly','monthly','yearly')),
  weekdays SMALLINT[] NOT NULL DEFAULT '{}',
  month_day SMALLINT,
  use_month_end BOOLEAN NOT NULL DEFAULT false,
  year_month SMALLINT,
  year_day SMALLINT,
  starts_on DATE NOT NULL,
  ends_on DATE,
  time_of_day TIME,
  memo TEXT,
  assignee_ids UUID[] NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','assignees','admins')),
  active BOOLEAN NOT NULL DEFAULT true,
  creator_user_id UUID NOT NULL DEFAULT auth.uid(),
  created_by TEXT,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  settlement_direction TEXT CHECK (settlement_direction IN ('pay','receive')),
  amount NUMERIC(14,2) CHECK (amount IS NULL OR amount >= 0),
  service_name TEXT,
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly','yearly')),
  payment_day SMALLINT,
  payment_method_name TEXT,
  payment_last4 TEXT CHECK (payment_last4 IS NULL OR payment_last4 ~ '^[0-9]{4}$'),
  cancel_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (recurrence_type <> 'weekly' OR cardinality(weekdays) > 0),
  CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 31),
  CHECK (year_month IS NULL OR year_month BETWEEN 1 AND 12),
  CHECK (year_day IS NULL OR year_day BETWEEN 1 AND 31),
  CHECK (payment_day IS NULL OR payment_day BETWEEN 1 AND 31),
  CHECK (kind <> 'vendor_settlement' OR (vendor_id IS NOT NULL AND settlement_direction IS NOT NULL)),
  CHECK (kind <> 'subscription' OR (nullif(trim(service_name), '') IS NOT NULL AND billing_cycle IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS calendar_routine_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id UUID NOT NULL REFERENCES calendar_routines(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
  override_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  processed_on DATE,
  actual_amount NUMERIC(14,2) CHECK (actual_amount IS NULL OR actual_amount >= 0),
  updated_by UUID DEFAULT auth.uid(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (routine_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_calendar_routines_active ON calendar_routines(active, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_calendar_routines_assignees ON calendar_routines USING gin(assignee_ids);
CREATE INDEX IF NOT EXISTS idx_calendar_occurrences_date ON calendar_routine_occurrences(occurrence_date, routine_id);

DO $$ BEGIN
  ALTER TABLE calendar_routines ADD CONSTRAINT calendar_payment_method_name_safe
    CHECK (payment_method_name IS NULL OR payment_method_name !~ '[0-9]{6,}');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS calendar_routines_updated_at ON calendar_routines;
CREATE TRIGGER calendar_routines_updated_at BEFORE UPDATE ON calendar_routines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS calendar_occurrences_updated_at ON calendar_routine_occurrences;
CREATE TRIGGER calendar_occurrences_updated_at BEFORE UPDATE ON calendar_routine_occurrences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION public.can_view_calendar_routine(r calendar_routines) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND get_user_role() IN ('MASTER','STAFF') AND (
    get_user_role() = 'MASTER'
    OR r.creator_user_id = auth.uid()
    OR r.visibility = 'all'
    OR (r.visibility = 'assignees' AND NULLIF(BTRIM(get_user_company_id()), '') = ANY(r.assignee_ids::text[]))
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_calendar_routine(r calendar_routines) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND get_user_role() IN ('MASTER','STAFF')
    AND (get_user_role() = 'MASTER' OR r.creator_user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.can_complete_calendar_routine(r calendar_routines) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND get_user_role() IN ('MASTER','STAFF') AND (
    get_user_role() = 'MASTER' OR NULLIF(BTRIM(get_user_company_id()), '') = ANY(r.assignee_ids::text[])
  )
$$;

DROP FUNCTION IF EXISTS public.current_company_id();

REVOKE ALL ON FUNCTION public.can_view_calendar_routine(calendar_routines) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_calendar_routine(calendar_routines) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_complete_calendar_routine(calendar_routines) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_calendar_routine(calendar_routines) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_calendar_routine(calendar_routines) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_complete_calendar_routine(calendar_routines) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_calendar_routine_occurrence_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_r calendar_routines;
  v_manage boolean;
  v_complete boolean;
BEGIN
  SELECT * INTO v_r FROM calendar_routines WHERE id = NEW.routine_id;
  IF NOT FOUND THEN RAISE EXCEPTION '없는 루틴입니다.' USING errcode='P0002'; END IF;
  v_manage := can_manage_calendar_routine(v_r);
  v_complete := can_complete_calendar_routine(v_r);

  IF TG_OP = 'UPDATE' AND (NEW.routine_id IS DISTINCT FROM OLD.routine_id OR NEW.occurrence_date IS DISTINCT FROM OLD.occurrence_date) THEN
    RAISE EXCEPTION '루틴과 회차 날짜는 바꿀 수 없습니다.' USING errcode='42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- INSERT ... ON CONFLICT 는 충돌 행도 BEFORE INSERT를 먼저 탄다.
    -- 이미 있는 회차는 뒤의 BEFORE UPDATE 검사에서 실제 변경 열만 판정한다.
    IF EXISTS (SELECT 1 FROM calendar_routine_occurrences o
               WHERE o.routine_id = NEW.routine_id AND o.occurrence_date = NEW.occurrence_date) THEN
      RETURN NEW;
    END IF;
    IF (NEW.status = 'skipped' OR NEW.override_data <> '{}'::jsonb) AND NOT v_manage THEN
      RAISE EXCEPTION '회차 수정과 건너뛰기는 만든 사람 또는 관리자만 할 수 있습니다.' USING errcode='42501';
    END IF;
    IF (NEW.status = 'done' OR NEW.completed_at IS NOT NULL OR NEW.processed_on IS NOT NULL OR NEW.actual_amount IS NOT NULL) AND NOT v_complete THEN
      RAISE EXCEPTION '회차 완료 권한이 없습니다.' USING errcode='42501';
    END IF;
    IF NEW.status = 'open' AND NEW.override_data = '{}'::jsonb AND NOT (v_manage OR v_complete) THEN
      RAISE EXCEPTION '회차 저장 권한이 없습니다.' USING errcode='42501';
    END IF;
  ELSE
    IF (NEW.override_data IS DISTINCT FROM OLD.override_data OR NEW.status = 'skipped' OR OLD.status = 'skipped') AND NOT v_manage THEN
      RAISE EXCEPTION '회차 수정과 건너뛰기는 만든 사람 또는 관리자만 할 수 있습니다.' USING errcode='42501';
    END IF;
    IF NOT (NEW.status = 'skipped' AND v_manage) AND ((NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('open','done') AND OLD.status IN ('open','done'))
        OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
        OR NEW.processed_on IS DISTINCT FROM OLD.processed_on
        OR NEW.actual_amount IS DISTINCT FROM OLD.actual_amount) AND NOT v_complete THEN
      RAISE EXCEPTION '회차 완료 권한이 없습니다.' USING errcode='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS calendar_occurrences_guard_write ON calendar_routine_occurrences;
CREATE TRIGGER calendar_occurrences_guard_write BEFORE INSERT OR UPDATE ON calendar_routine_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_routine_occurrence_write();

REVOKE ALL ON FUNCTION public.guard_calendar_routine_occurrence_write() FROM PUBLIC, anon;

ALTER TABLE calendar_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_routine_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_routines_select ON calendar_routines;
DROP POLICY IF EXISTS calendar_routines_insert ON calendar_routines;
DROP POLICY IF EXISTS calendar_routines_update ON calendar_routines;
DROP POLICY IF EXISTS calendar_routines_delete ON calendar_routines;
CREATE POLICY calendar_routines_select ON calendar_routines FOR SELECT TO authenticated
  USING (can_view_calendar_routine(calendar_routines));
CREATE POLICY calendar_routines_insert ON calendar_routines FOR INSERT TO authenticated
  WITH CHECK (creator_user_id = auth.uid() AND get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY calendar_routines_update ON calendar_routines FOR UPDATE TO authenticated
  USING (can_manage_calendar_routine(calendar_routines))
  WITH CHECK (can_manage_calendar_routine(calendar_routines));
CREATE POLICY calendar_routines_delete ON calendar_routines FOR DELETE TO authenticated
  USING (can_manage_calendar_routine(calendar_routines));

DROP POLICY IF EXISTS calendar_occurrences_select ON calendar_routine_occurrences;
DROP POLICY IF EXISTS calendar_occurrences_insert ON calendar_routine_occurrences;
DROP POLICY IF EXISTS calendar_occurrences_update ON calendar_routine_occurrences;
DROP POLICY IF EXISTS calendar_occurrences_delete ON calendar_routine_occurrences;
CREATE POLICY calendar_occurrences_select ON calendar_routine_occurrences FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM calendar_routines r WHERE r.id=routine_id AND can_view_calendar_routine(r)));
CREATE POLICY calendar_occurrences_insert ON calendar_routine_occurrences FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM calendar_routines r WHERE r.id=routine_id
      AND (can_manage_calendar_routine(r) OR can_complete_calendar_routine(r))
  ));
CREATE POLICY calendar_occurrences_update ON calendar_routine_occurrences FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM calendar_routines r WHERE r.id=routine_id AND (can_manage_calendar_routine(r) OR can_complete_calendar_routine(r))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM calendar_routines r WHERE r.id=routine_id
      AND (can_manage_calendar_routine(r) OR can_complete_calendar_routine(r))
  ));
CREATE POLICY calendar_occurrences_delete ON calendar_routine_occurrences FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM calendar_routines r WHERE r.id=routine_id AND can_manage_calendar_routine(r)));

NOTIFY pgrst, 'reload schema';
