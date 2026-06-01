CREATE TABLE IF NOT EXISTS public.player_streak_presentations (
  player_address TEXT NOT NULL,
  period_id BIGINT NOT NULL,
  streak INTEGER NOT NULL CHECK (streak >= 0),
  presented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_address, period_id)
);

CREATE INDEX IF NOT EXISTS idx_player_streak_presentations_player_presented_at
  ON public.player_streak_presentations (player_address, presented_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_streak_presentations_period_id
  ON public.player_streak_presentations (period_id);

COMMENT ON TABLE public.player_streak_presentations IS 'Once-per-player daily streak presentation receipts.';
COMMENT ON COLUMN public.player_streak_presentations.player_address IS 'Normalized Starknet player address.';
COMMENT ON COLUMN public.player_streak_presentations.period_id IS 'Daily period id for the streak presentation.';
COMMENT ON COLUMN public.player_streak_presentations.streak IS 'Streak value shown to the player.';
COMMENT ON COLUMN public.player_streak_presentations.presented_at IS 'When the presentation receipt was claimed.';

ALTER TABLE public.player_streak_presentations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to player streak presentations" ON public.player_streak_presentations;
CREATE POLICY "Allow public read access to player streak presentations"
ON public.player_streak_presentations
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow all operations on player streak presentations" ON public.player_streak_presentations;
CREATE POLICY "Allow all operations on player streak presentations"
ON public.player_streak_presentations
FOR ALL
USING (true)
WITH CHECK (true);
