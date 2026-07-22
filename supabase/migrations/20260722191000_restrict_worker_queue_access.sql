-- Queue rows can execute approved NFT transfers while set_approval_for_all is
-- active. Only trusted server processes may read or mutate queue/batch data.

ALTER TABLE public.torii_worker_intent_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.torii_worker_transaction_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on intent queue"
  ON public.torii_worker_intent_queue;
DROP POLICY IF EXISTS "Server manages intent queue"
  ON public.torii_worker_intent_queue;
CREATE POLICY "Server manages intent queue"
  ON public.torii_worker_intent_queue
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on worker transaction batches"
  ON public.torii_worker_transaction_batches;
DROP POLICY IF EXISTS "Server manages worker transaction batches"
  ON public.torii_worker_transaction_batches;
CREATE POLICY "Server manages worker transaction batches"
  ON public.torii_worker_transaction_batches
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.torii_worker_intent_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.torii_worker_transaction_batches FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.torii_worker_intent_queue, public.torii_worker_transaction_batches
  TO service_role;

NOTIFY pgrst, 'reload schema';
