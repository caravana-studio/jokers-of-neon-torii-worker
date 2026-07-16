-- Parallel Starknet multicalls for the Torii worker while keeping semantic
-- intents in torii_worker_intent_queue. This migration intentionally reuses
-- the executor_accounts pool owned by the API.

DO $$
BEGIN
  IF to_regclass('public.executor_accounts') IS NULL THEN
    RAISE EXCEPTION 'executor_accounts is required; apply the API executor pool migration first';
  END IF;
  IF to_regprocedure('public.acquire_executor(text)') IS NULL THEN
    RAISE EXCEPTION 'acquire_executor(text) is required; apply the full API executor pool migration first';
  END IF;
END
$$;

-- Executor signing keys are server-only. The scalable API queue is migrated to
-- its service-role client in the same rollout.
ALTER TABLE public.executor_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.executor_accounts FROM anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.executor_accounts TO service_role;

DROP POLICY IF EXISTS "Server manages executor accounts" ON public.executor_accounts;
CREATE POLICY "Server manages executor accounts"
  ON public.executor_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.torii_worker_intent_queue
  ADD COLUMN IF NOT EXISTS batch_id TEXT,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ordering_key TEXT,
  ADD COLUMN IF NOT EXISTS force_single BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.torii_worker_intent_queue
  DROP CONSTRAINT IF EXISTS torii_worker_intent_queue_status_check;

ALTER TABLE public.torii_worker_intent_queue
  ADD CONSTRAINT torii_worker_intent_queue_status_check
  CHECK (status IN ('pending', 'processing', 'submitted', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_torii_worker_intent_queue_available
  ON public.torii_worker_intent_queue (blockchain, status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_torii_worker_intent_queue_batch
  ON public.torii_worker_intent_queue (batch_id)
  WHERE batch_id IS NOT NULL;

DROP INDEX IF EXISTS public.idx_torii_worker_intent_queue_ordering_inflight;
CREATE UNIQUE INDEX idx_torii_worker_intent_queue_ordering_inflight
  ON public.torii_worker_intent_queue (ordering_key)
  WHERE ordering_key IS NOT NULL AND status IN ('processing', 'submitted');

CREATE TABLE IF NOT EXISTS public.torii_worker_transaction_batches (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  blockchain TEXT NOT NULL DEFAULT 'starknet' CHECK (blockchain = 'starknet'),
  executor_id BIGINT NOT NULL REFERENCES public.executor_accounts(id),
  executor_address TEXT NOT NULL,
  transaction_ids TEXT[] NOT NULL,
  transaction_count INTEGER NOT NULL CHECK (transaction_count > 0),
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'submitted', 'completed', 'failed')),
  nonce TEXT,
  transaction_hash TEXT,
  actual_fee JSONB,
  error_message TEXT,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_torii_worker_batches_status
  ON public.torii_worker_transaction_batches (status, created_at);

CREATE INDEX IF NOT EXISTS idx_torii_worker_batches_executor
  ON public.torii_worker_transaction_batches (executor_id, status);

DROP TRIGGER IF EXISTS update_torii_worker_transaction_batches_updated_at
  ON public.torii_worker_transaction_batches;
CREATE TRIGGER update_torii_worker_transaction_batches_updated_at
  BEFORE UPDATE ON public.torii_worker_transaction_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.torii_worker_transaction_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on worker transaction batches"
  ON public.torii_worker_transaction_batches;
CREATE POLICY "Allow all operations on worker transaction batches"
  ON public.torii_worker_transaction_batches
  FOR ALL
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.torii_worker_intent_queue, public.torii_worker_transaction_batches
  TO service_role;

-- Old deployments briefly stored Slot mission generation as Starknet intents.
-- Move only still-pending legacy rows before the multicall claimer sees them.
UPDATE public.torii_worker_intent_queue
SET blockchain = 'slot'
WHERE blockchain = 'starknet'
  AND status = 'pending'
  AND operation IN ('missions.generate_daily', 'missions.generate_weekly');

CREATE OR REPLACE FUNCTION public.claim_torii_worker_starknet_batch(
  p_worker_id TEXT,
  p_batch_id TEXT,
  p_max_batch_size INTEGER,
  p_batch_wait_ms INTEGER,
  p_lease_ms INTEGER,
  p_executor_ids BIGINT[] DEFAULT NULL
)
RETURNS TABLE (
  claimed_batch_id TEXT,
  claimed_executor_id BIGINT,
  claimed_executor_name TEXT,
  claimed_executor_address TEXT,
  claimed_executor_private_key TEXT,
  claimed_intents JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_id TEXT;
  v_first_force_single BOOLEAN;
  v_first_created_at TIMESTAMPTZ;
  v_candidate_count BIGINT;
  v_executor RECORD;
  v_transaction_ids TEXT[];
  v_intents JSONB;
  v_limit INTEGER;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_max_batch_size < 1 OR p_batch_wait_ms < 0 OR p_lease_ms < 1 THEN
    RAISE EXCEPTION 'Invalid batch claim configuration';
  END IF;

  SELECT q.id, q.force_single, q.created_at
  INTO v_first_id, v_first_force_single, v_first_created_at
  FROM public.torii_worker_intent_queue q
  WHERE q.blockchain = 'starknet'
    AND q.status = 'pending'
    AND q.available_at <= v_now
    AND (
      q.ordering_key IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.torii_worker_intent_queue earlier
        WHERE earlier.ordering_key = q.ordering_key
          AND earlier.status = 'pending'
          AND (earlier.created_at, earlier.id) < (q.created_at, q.id)
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.torii_worker_intent_queue in_flight
      WHERE q.ordering_key IS NOT NULL
        AND in_flight.ordering_key = q.ordering_key
        AND in_flight.status IN ('processing', 'submitted')
    )
  ORDER BY q.created_at ASC, q.id ASC
  LIMIT 1;

  IF v_first_id IS NULL THEN
    RETURN;
  END IF;

  IF v_first_force_single THEN
    v_limit := 1;
  ELSE
    SELECT COUNT(*)
    INTO v_candidate_count
    FROM public.torii_worker_intent_queue q
    WHERE q.blockchain = 'starknet'
      AND q.status = 'pending'
      AND q.force_single = FALSE
      AND q.available_at <= v_now
      AND (
        q.ordering_key IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.torii_worker_intent_queue earlier
          WHERE earlier.ordering_key = q.ordering_key
            AND earlier.status = 'pending'
            AND (earlier.created_at, earlier.id) < (q.created_at, q.id)
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.torii_worker_intent_queue in_flight
        WHERE q.ordering_key IS NOT NULL
          AND in_flight.ordering_key = q.ordering_key
          AND in_flight.status IN ('processing', 'submitted')
      );

    IF v_candidate_count < p_max_batch_size
      AND v_first_created_at > v_now - (p_batch_wait_ms * INTERVAL '1 millisecond') THEN
      RETURN;
    END IF;

    v_limit := p_max_batch_size;
  END IF;

  SELECT ea.id, ea.name, ea.address, ea.private_key
  INTO v_executor
  FROM public.executor_accounts ea
  WHERE ea.is_active = TRUE
    AND ea.is_busy = FALSE
    AND (p_executor_ids IS NULL OR ea.id = ANY(p_executor_ids))
  ORDER BY ea.last_activity_at ASC NULLS FIRST, ea.id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_first_force_single THEN
    SELECT ARRAY_AGG(candidate.id ORDER BY candidate.created_at, candidate.id)
    INTO v_transaction_ids
    FROM (
      SELECT q.id, q.created_at
      FROM public.torii_worker_intent_queue q
      WHERE q.id = v_first_id
        AND q.status = 'pending'
        AND q.available_at <= v_now
      FOR UPDATE SKIP LOCKED
    ) candidate;
  ELSE
    SELECT ARRAY_AGG(candidate.id ORDER BY candidate.created_at, candidate.id)
    INTO v_transaction_ids
    FROM (
      SELECT q.id, q.created_at
      FROM public.torii_worker_intent_queue q
      WHERE q.blockchain = 'starknet'
        AND q.status = 'pending'
        AND q.force_single = FALSE
        AND q.available_at <= v_now
        AND (
          q.ordering_key IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM public.torii_worker_intent_queue earlier
            WHERE earlier.ordering_key = q.ordering_key
              AND earlier.status = 'pending'
              AND (earlier.created_at, earlier.id) < (q.created_at, q.id)
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.torii_worker_intent_queue in_flight
          WHERE q.ordering_key IS NOT NULL
            AND in_flight.ordering_key = q.ordering_key
            AND in_flight.status IN ('processing', 'submitted')
        )
      ORDER BY q.created_at ASC, q.id ASC
      LIMIT v_limit
      FOR UPDATE SKIP LOCKED
    ) candidate;
  END IF;

  IF COALESCE(array_length(v_transaction_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.torii_worker_transaction_batches (
    id,
    worker_id,
    executor_id,
    executor_address,
    transaction_ids,
    transaction_count,
    status,
    lease_expires_at
  ) VALUES (
    p_batch_id,
    p_worker_id,
    v_executor.id,
    v_executor.address,
    v_transaction_ids,
    array_length(v_transaction_ids, 1),
    'processing',
    v_now + (p_lease_ms * INTERVAL '1 millisecond')
  );

  UPDATE public.torii_worker_intent_queue q
  SET status = 'processing',
      batch_id = p_batch_id,
      lease_owner = p_worker_id,
      lease_expires_at = v_now + (p_lease_ms * INTERVAL '1 millisecond')
  WHERE q.id = ANY(v_transaction_ids)
    AND q.status = 'pending';

  UPDATE public.executor_accounts ea
  SET is_busy = TRUE,
      current_batch_id = p_batch_id,
      last_activity_at = v_now,
      updated_at = v_now
  WHERE ea.id = v_executor.id;

  SELECT JSONB_AGG(TO_JSONB(q) ORDER BY q.created_at, q.id)
  INTO v_intents
  FROM public.torii_worker_intent_queue q
  WHERE q.id = ANY(v_transaction_ids);

  RETURN QUERY SELECT
    p_batch_id,
    v_executor.id,
    v_executor.name,
    v_executor.address,
    v_executor.private_key,
    v_intents;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_torii_worker_single_intent(
  p_worker_id TEXT,
  p_blockchain TEXT,
  p_lease_ms INTEGER
)
RETURNS TABLE (claimed_intent JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent_id TEXT;
  v_intent JSONB;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT q.id
  INTO v_intent_id
  FROM public.torii_worker_intent_queue q
  WHERE q.blockchain = p_blockchain
    AND q.status = 'pending'
    AND q.available_at <= v_now
    AND (
      q.ordering_key IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.torii_worker_intent_queue earlier
        WHERE earlier.ordering_key = q.ordering_key
          AND earlier.status = 'pending'
          AND (earlier.created_at, earlier.id) < (q.created_at, q.id)
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.torii_worker_intent_queue in_flight
      WHERE q.ordering_key IS NOT NULL
        AND in_flight.ordering_key = q.ordering_key
        AND in_flight.status IN ('processing', 'submitted')
    )
  ORDER BY q.created_at ASC, q.id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_intent_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.torii_worker_intent_queue q
  SET status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = v_now + (p_lease_ms * INTERVAL '1 millisecond')
  WHERE q.id = v_intent_id
    AND q.status = 'pending'
  RETURNING TO_JSONB(q) INTO v_intent;

  IF v_intent IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_intent;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_torii_worker_orphaned_work()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch RECORD;
  v_recovered INTEGER := 0;
  v_count INTEGER := 0;
BEGIN
  FOR v_batch IN
    SELECT b.id, b.executor_id
    FROM public.torii_worker_transaction_batches b
    WHERE b.status = 'processing'
      AND b.transaction_hash IS NULL
      AND b.lease_expires_at < NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.torii_worker_intent_queue q
    SET status = 'pending',
        batch_id = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        available_at = NOW()
    WHERE q.batch_id = v_batch.id
      AND q.status = 'processing';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_recovered := v_recovered + v_count;

    UPDATE public.executor_accounts ea
    SET is_busy = FALSE,
        current_batch_id = NULL,
        updated_at = NOW()
    WHERE ea.id = v_batch.executor_id
      AND ea.current_batch_id = v_batch.id;

    UPDATE public.torii_worker_transaction_batches b
    SET status = 'failed',
        error_message = 'Recovered expired pre-submission lease',
        completed_at = NOW()
    WHERE b.id = v_batch.id;
  END LOOP;

  UPDATE public.torii_worker_intent_queue q
  SET status = 'pending',
      lease_owner = NULL,
      lease_expires_at = NULL,
      available_at = NOW()
  WHERE q.status = 'processing'
    AND q.batch_id IS NULL
    AND q.lease_expires_at < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_recovered + v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_torii_worker_executor(
  p_executor_id BIGINT,
  p_batch_id TEXT,
  p_success BOOLEAN,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_count INTEGER := 0;
  v_released BOOLEAN := FALSE;
BEGIN
  SELECT b.transaction_count
  INTO v_transaction_count
  FROM public.torii_worker_transaction_batches b
  WHERE b.id = p_batch_id;

  UPDATE public.executor_accounts ea
  SET is_busy = FALSE,
      current_batch_id = NULL,
      total_batches_executed = COALESCE(ea.total_batches_executed, 0) + CASE WHEN p_success THEN 1 ELSE 0 END,
      total_transactions_executed = COALESCE(ea.total_transactions_executed, 0) + CASE WHEN p_success THEN COALESCE(v_transaction_count, 0) ELSE 0 END,
      last_error_at = CASE WHEN p_success THEN ea.last_error_at ELSE NOW() END,
      last_error_message = CASE WHEN p_success THEN ea.last_error_message ELSE p_error_message END,
      updated_at = NOW()
  WHERE ea.id = p_executor_id
    AND ea.current_batch_id = p_batch_id;

  GET DIAGNOSTICS v_transaction_count = ROW_COUNT;
  v_released := v_transaction_count > 0;
  RETURN v_released;
END;
$$;

-- Shared ownership-safe release used by the API. The current_batch_id
-- predicate prevents a stale API process from releasing an executor that has
-- already been reassigned to a worker batch (or vice versa).
CREATE OR REPLACE FUNCTION public.release_shared_executor(
  p_executor_id BIGINT,
  p_batch_id TEXT,
  p_success BOOLEAN,
  p_transaction_count INTEGER DEFAULT 0,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released_count INTEGER := 0;
BEGIN
  UPDATE public.executor_accounts ea
  SET is_busy = FALSE,
      current_batch_id = NULL,
      total_batches_executed = COALESCE(ea.total_batches_executed, 0)
        + CASE WHEN p_success THEN 1 ELSE 0 END,
      total_transactions_executed = COALESCE(ea.total_transactions_executed, 0)
        + CASE WHEN p_success THEN GREATEST(COALESCE(p_transaction_count, 0), 0) ELSE 0 END,
      last_error_at = CASE WHEN p_success THEN ea.last_error_at ELSE NOW() END,
      last_error_message = CASE WHEN p_success THEN ea.last_error_message ELSE p_error_message END,
      updated_at = NOW()
  WHERE ea.id = p_executor_id
    AND ea.current_batch_id = p_batch_id;

  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  RETURN v_released_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_torii_worker_starknet_batch(TEXT, TEXT, INTEGER, INTEGER, INTEGER, BIGINT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_torii_worker_single_intent(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_torii_worker_orphaned_work() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_torii_worker_executor(BIGINT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_shared_executor(BIGINT, TEXT, BOOLEAN, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_executor(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_available_executor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_executor(BIGINT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_torii_worker_starknet_batch(TEXT, TEXT, INTEGER, INTEGER, INTEGER, BIGINT[]) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_torii_worker_single_intent(TEXT, TEXT, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_torii_worker_orphaned_work() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_torii_worker_executor(BIGINT, TEXT, BOOLEAN, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_shared_executor(BIGINT, TEXT, BOOLEAN, INTEGER, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_executor(TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_available_executor() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_executor(BIGINT, BOOLEAN, TEXT) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_torii_worker_starknet_batch(TEXT, TEXT, INTEGER, INTEGER, INTEGER, BIGINT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_torii_worker_single_intent(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_torii_worker_orphaned_work() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_torii_worker_executor(BIGINT, TEXT, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_shared_executor(BIGINT, TEXT, BOOLEAN, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_executor(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_available_executor() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_executor(BIGINT, BOOLEAN, TEXT) TO service_role;
