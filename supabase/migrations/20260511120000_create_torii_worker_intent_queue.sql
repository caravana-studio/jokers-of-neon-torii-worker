CREATE TABLE IF NOT EXISTS public.torii_worker_intent_queue (
  id TEXT PRIMARY KEY,
  blockchain TEXT NOT NULL,
  operation TEXT NOT NULL,
  target_ref TEXT,
  payload JSONB NOT NULL,
  intent_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  retries INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  transaction_hash TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_torii_worker_intent_queue_status
  ON public.torii_worker_intent_queue (status);

CREATE INDEX IF NOT EXISTS idx_torii_worker_intent_queue_created_at
  ON public.torii_worker_intent_queue (created_at);

CREATE INDEX IF NOT EXISTS idx_torii_worker_intent_queue_status_created_at
  ON public.torii_worker_intent_queue (status, created_at);

CREATE INDEX IF NOT EXISTS idx_torii_worker_intent_queue_blockchain_status_created_at
  ON public.torii_worker_intent_queue (blockchain, status, created_at);

CREATE INDEX IF NOT EXISTS idx_torii_worker_intent_queue_operation_status
  ON public.torii_worker_intent_queue (operation, status);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_torii_worker_intent_queue_updated_at ON public.torii_worker_intent_queue;
CREATE TRIGGER update_torii_worker_intent_queue_updated_at
  BEFORE UPDATE ON public.torii_worker_intent_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.torii_worker_intent_queue IS 'Persistent queue for worker transaction intents. Chain support is validated by the worker adapter registry.';
COMMENT ON COLUMN public.torii_worker_intent_queue.blockchain IS 'Target blockchain adapter id, for example starknet or celo. No DB allowlist is enforced.';
COMMENT ON COLUMN public.torii_worker_intent_queue.operation IS 'Semantic operation to execute, for example game.snapshot or progression.sync.';
COMMENT ON COLUMN public.torii_worker_intent_queue.target_ref IS 'Optional logical target used by adapters, for example profile_system.';
COMMENT ON COLUMN public.torii_worker_intent_queue.payload IS 'Adapter-independent operation payload.';
COMMENT ON COLUMN public.torii_worker_intent_queue.intent_version IS 'Payload contract version for forward-compatible migrations.';
COMMENT ON COLUMN public.torii_worker_intent_queue.metadata IS 'Non-critical context for debugging and observability.';

ALTER TABLE public.torii_worker_intent_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on intent queue" ON public.torii_worker_intent_queue;
CREATE POLICY "Allow all operations on intent queue"
ON public.torii_worker_intent_queue
FOR ALL
USING (true)
WITH CHECK (true);
