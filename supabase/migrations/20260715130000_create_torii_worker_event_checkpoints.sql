CREATE TABLE IF NOT EXISTS public.torii_worker_event_checkpoints (
  checkpoint_key TEXT PRIMARY KEY,
  slot_env TEXT NOT NULL,
  world_address TEXT NOT NULL,
  listener_name TEXT NOT NULL,
  last_event_id TEXT,
  last_cursor TEXT,
  last_executed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_torii_worker_event_checkpoints_slot_world
  ON public.torii_worker_event_checkpoints (slot_env, world_address);

DROP TRIGGER IF EXISTS update_torii_worker_event_checkpoints_updated_at ON public.torii_worker_event_checkpoints;
CREATE TRIGGER update_torii_worker_event_checkpoints_updated_at
  BEFORE UPDATE ON public.torii_worker_event_checkpoints
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.torii_worker_event_checkpoints IS 'Persistent checkpoints for Torii event listeners.';
COMMENT ON COLUMN public.torii_worker_event_checkpoints.last_cursor IS 'GraphQL eventMessages cursor matching last_event_id when available.';

ALTER TABLE public.torii_worker_event_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on torii worker event checkpoints" ON public.torii_worker_event_checkpoints;
CREATE POLICY "Allow all operations on torii worker event checkpoints"
ON public.torii_worker_event_checkpoints
FOR ALL
USING (true)
WITH CHECK (true);
