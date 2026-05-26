CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.player_streaks (
  player_address TEXT PRIMARY KEY,
  username TEXT,
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  effective_streak INTEGER NOT NULL DEFAULT 0 CHECK (effective_streak >= 0),
  longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_completed_day BIGINT NOT NULL DEFAULT 0,
  protectors_available INTEGER NOT NULL DEFAULT 0 CHECK (protectors_available >= 0),
  protectors_needed BIGINT NOT NULL DEFAULT 0 CHECK (protectors_needed >= 0),
  days_missed BIGINT NOT NULL DEFAULT 0 CHECK (days_missed >= 0),
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  is_broken BOOLEAN NOT NULL DEFAULT FALSE,
  sync_status TEXT NOT NULL DEFAULT 'confirmed' CHECK (sync_status IN ('confirmed', 'pending', 'failed')),
  pending_period_id BIGINT,
  pending_mission_id TEXT,
  pending_template_id TEXT,
  last_tx_hash TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_streaks_effective_streak
  ON public.player_streaks (effective_streak DESC, longest_streak DESC, last_completed_day DESC);

CREATE INDEX IF NOT EXISTS idx_player_streaks_sync_status
  ON public.player_streaks (sync_status);

CREATE INDEX IF NOT EXISTS idx_player_streaks_pending_period
  ON public.player_streaks (pending_period_id)
  WHERE pending_period_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_player_streaks_updated_at ON public.player_streaks;
CREATE TRIGGER update_player_streaks_updated_at
  BEFORE UPDATE ON public.player_streaks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.player_streaks IS 'Cached player daily streak state for fast reads and leaderboards.';
COMMENT ON COLUMN public.player_streaks.player_address IS 'Normalized Starknet player address.';
COMMENT ON COLUMN public.player_streaks.current_streak IS 'Last known on-chain streak count.';
COMMENT ON COLUMN public.player_streaks.effective_streak IS 'Streak count adjusted for missed days and available protectors.';
COMMENT ON COLUMN public.player_streaks.sync_status IS 'Whether the cached daily mission completion is pending, confirmed, or failed on-chain.';

ALTER TABLE public.player_streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to player streaks" ON public.player_streaks;
CREATE POLICY "Allow public read access to player streaks"
ON public.player_streaks
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow all operations on player streaks" ON public.player_streaks;
CREATE POLICY "Allow all operations on player streaks"
ON public.player_streaks
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.player_streak_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_address TEXT NOT NULL,
  event_type TEXT NOT NULL,
  period_id BIGINT,
  mission_id TEXT,
  template_id TEXT,
  current_streak INTEGER CHECK (current_streak IS NULL OR current_streak >= 0),
  protectors_used INTEGER CHECK (protectors_used IS NULL OR protectors_used >= 0),
  protectors_available INTEGER CHECK (protectors_available IS NULL OR protectors_available >= 0),
  tx_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_streak_events_player_created_at
  ON public.player_streak_events (player_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_streak_events_event_type
  ON public.player_streak_events (event_type);

CREATE INDEX IF NOT EXISTS idx_player_streak_events_period_id
  ON public.player_streak_events (period_id);

COMMENT ON TABLE public.player_streak_events IS 'Append-only audit log for player streak cache updates.';
COMMENT ON COLUMN public.player_streak_events.player_address IS 'Normalized Starknet player address.';
COMMENT ON COLUMN public.player_streak_events.event_type IS 'Streak cache event type, for example daily_mission_pending or daily_mission_confirmed.';
COMMENT ON COLUMN public.player_streak_events.metadata IS 'Additional non-critical context from the worker.';

ALTER TABLE public.player_streak_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to player streak events" ON public.player_streak_events;
CREATE POLICY "Allow public read access to player streak events"
ON public.player_streak_events
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow all operations on player streak events" ON public.player_streak_events;
CREATE POLICY "Allow all operations on player streak events"
ON public.player_streak_events
FOR ALL
USING (true)
WITH CHECK (true);
