-- Make the daily streak cache transition atomic with its XP intent, and keep
-- all queue/cache mutations server-only.

ALTER TABLE public.player_streaks
  ADD COLUMN IF NOT EXISTS pending_intent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_player_streaks_pending_intent
  ON public.player_streaks (pending_intent_id)
  WHERE pending_intent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enqueue_daily_streak_intent(
  p_intent JSONB,
  p_streak JSONB,
  p_event JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent_id TEXT := p_intent->>'id';
  v_streak_updated BOOLEAN := FALSE;
BEGIN
  IF v_intent_id IS NULL OR v_intent_id = '' THEN
    RAISE EXCEPTION 'Intent id is required';
  END IF;

  IF p_intent->>'operation' <> 'xp.mission_completed' THEN
    RAISE EXCEPTION 'Atomic daily streak enqueue only accepts xp.mission_completed';
  END IF;

  INSERT INTO public.torii_worker_intent_queue (
    id,
    blockchain,
    operation,
    target_ref,
    payload,
    intent_version,
    metadata,
    ordering_key,
    status,
    retries,
    max_retries,
    available_at
  ) VALUES (
    v_intent_id,
    p_intent->>'blockchain',
    p_intent->>'operation',
    NULLIF(p_intent->>'target_ref', ''),
    COALESCE(p_intent->'payload', '{}'::JSONB),
    COALESCE((p_intent->>'intent_version')::INTEGER, 1),
    COALESCE(p_intent->'metadata', '{}'::JSONB),
    NULLIF(p_intent->>'ordering_key', ''),
    'pending',
    0,
    COALESCE((p_intent->>'max_retries')::INTEGER, 3),
    NOW()
  );

  INSERT INTO public.player_streaks (
    player_address,
    username,
    current_streak,
    effective_streak,
    longest_streak,
    last_completed_day,
    protectors_available,
    protectors_needed,
    days_missed,
    is_protected,
    is_broken,
    sync_status,
    pending_period_id,
    pending_mission_id,
    pending_template_id,
    pending_intent_id
  ) VALUES (
    p_streak->>'player_address',
    p_streak->>'username',
    (p_streak->>'current_streak')::INTEGER,
    (p_streak->>'effective_streak')::INTEGER,
    (p_streak->>'longest_streak')::INTEGER,
    (p_streak->>'last_completed_day')::BIGINT,
    (p_streak->>'protectors_available')::INTEGER,
    (p_streak->>'protectors_needed')::BIGINT,
    (p_streak->>'days_missed')::BIGINT,
    (p_streak->>'is_protected')::BOOLEAN,
    (p_streak->>'is_broken')::BOOLEAN,
    'pending',
    (p_streak->>'pending_period_id')::BIGINT,
    NULLIF(p_streak->>'pending_mission_id', ''),
    NULLIF(p_streak->>'pending_template_id', ''),
    v_intent_id
  )
  ON CONFLICT (player_address) DO UPDATE SET
    username = EXCLUDED.username,
    current_streak = EXCLUDED.current_streak,
    effective_streak = EXCLUDED.effective_streak,
    longest_streak = EXCLUDED.longest_streak,
    last_completed_day = EXCLUDED.last_completed_day,
    protectors_available = EXCLUDED.protectors_available,
    protectors_needed = EXCLUDED.protectors_needed,
    days_missed = EXCLUDED.days_missed,
    is_protected = EXCLUDED.is_protected,
    is_broken = EXCLUDED.is_broken,
    sync_status = 'pending',
    pending_period_id = EXCLUDED.pending_period_id,
    pending_mission_id = EXCLUDED.pending_mission_id,
    pending_template_id = EXCLUDED.pending_template_id,
    pending_intent_id = EXCLUDED.pending_intent_id
  WHERE public.player_streaks.last_completed_day < EXCLUDED.last_completed_day
  RETURNING TRUE INTO v_streak_updated;

  IF COALESCE(v_streak_updated, FALSE) THEN
    INSERT INTO public.player_streak_events (
      player_address,
      event_type,
      period_id,
      mission_id,
      template_id,
      current_streak,
      protectors_used,
      protectors_available,
      metadata
    ) VALUES (
      p_event->>'player_address',
      'daily_mission_pending',
      (p_event->>'period_id')::BIGINT,
      NULLIF(p_event->>'mission_id', ''),
      NULLIF(p_event->>'template_id', ''),
      (p_event->>'current_streak')::INTEGER,
      (p_event->>'protectors_used')::INTEGER,
      (p_event->>'protectors_available')::INTEGER,
      COALESCE(p_event->'metadata', '{}'::JSONB)
    );
  END IF;

  RETURN jsonb_build_object(
    'intentId', v_intent_id,
    'streakUpdated', COALESCE(v_streak_updated, FALSE)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_daily_streak_intent(JSONB, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_daily_streak_intent(JSONB, JSONB, JSONB)
  TO service_role;

-- Remove every permissive mutation policy used by previous deployments.
DROP POLICY IF EXISTS "Allow all operations on player streaks" ON public.player_streaks;
DROP POLICY IF EXISTS "Anon can upsert player streaks" ON public.player_streaks;
DROP POLICY IF EXISTS "Allow all operations on player streak events" ON public.player_streak_events;
DROP POLICY IF EXISTS "Anon can insert player streak events" ON public.player_streak_events;
DROP POLICY IF EXISTS "Allow all operations on player streak presentations" ON public.player_streak_presentations;
DROP POLICY IF EXISTS "Allow all operations on intent queue" ON public.torii_worker_intent_queue;
DROP POLICY IF EXISTS "Allow all operations on transaction queue" ON public.torii_worker_transaction_queue;
DROP POLICY IF EXISTS "Allow all operations on worker transaction batches" ON public.torii_worker_transaction_batches;
DROP POLICY IF EXISTS "Server manages player streaks" ON public.player_streaks;
DROP POLICY IF EXISTS "Server manages player streak events" ON public.player_streak_events;
DROP POLICY IF EXISTS "Server manages streak presentations" ON public.player_streak_presentations;
DROP POLICY IF EXISTS "Server manages worker intents" ON public.torii_worker_intent_queue;
DROP POLICY IF EXISTS "Server manages legacy worker queue" ON public.torii_worker_transaction_queue;
DROP POLICY IF EXISTS "Server manages worker batches" ON public.torii_worker_transaction_batches;

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.player_streaks,
  public.player_streak_events,
  public.player_streak_presentations,
  public.torii_worker_intent_queue,
  public.torii_worker_transaction_queue,
  public.torii_worker_transaction_batches
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.player_streaks,
  public.player_streak_events,
  public.player_streak_presentations,
  public.torii_worker_intent_queue,
  public.torii_worker_transaction_queue,
  public.torii_worker_transaction_batches
TO service_role;

CREATE POLICY "Server manages player streaks"
  ON public.player_streaks FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Server manages player streak events"
  ON public.player_streak_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Server manages streak presentations"
  ON public.player_streak_presentations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Server manages worker intents"
  ON public.torii_worker_intent_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Server manages legacy worker queue"
  ON public.torii_worker_transaction_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Server manages worker batches"
  ON public.torii_worker_transaction_batches FOR ALL TO service_role
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
