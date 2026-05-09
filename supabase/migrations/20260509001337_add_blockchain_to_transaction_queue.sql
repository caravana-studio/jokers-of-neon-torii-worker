ALTER TABLE public.torii_worker_transaction_queue
  ADD COLUMN IF NOT EXISTS blockchain text;

UPDATE public.torii_worker_transaction_queue
SET blockchain = 'starknet'
WHERE blockchain IS NULL;

ALTER TABLE public.torii_worker_transaction_queue
  ALTER COLUMN blockchain SET DEFAULT 'starknet',
  ALTER COLUMN blockchain SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'torii_worker_transaction_queue_blockchain_check'
      AND conrelid = 'public.torii_worker_transaction_queue'::regclass
  ) THEN
    ALTER TABLE public.torii_worker_transaction_queue
      ADD CONSTRAINT torii_worker_transaction_queue_blockchain_check
      CHECK (blockchain IN ('starknet', 'celo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_torii_worker_tx_queue_blockchain_status_created_at
  ON public.torii_worker_transaction_queue (blockchain, status, created_at);
