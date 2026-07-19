import { isSupabaseConfigured, supabase } from '../config/supabase.js';

const CHECKPOINT_TABLE = 'torii_worker_event_checkpoints';

export interface ToriiEventCheckpoint {
  checkpointKey: string;
  slotEnv: string;
  worldAddress: string;
  listenerName: string;
  lastEventId: string | null;
  lastCursor: string | null;
  lastExecutedAt: string | null;
  metadata?: Record<string, unknown>;
}

export interface SaveToriiEventCheckpointInput extends ToriiEventCheckpoint {
  metadata: Record<string, unknown>;
}

const memoryCheckpoints = new Map<string, ToriiEventCheckpoint>();

function checkpointStorageError(action: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`[torii-checkpoint] action=${action} storage=supabase failed: ${detail}`);
}

function fromRow(row: Record<string, unknown>): ToriiEventCheckpoint {
  return {
    checkpointKey: String(row.checkpoint_key),
    slotEnv: String(row.slot_env),
    worldAddress: String(row.world_address),
    listenerName: String(row.listener_name),
    lastEventId: typeof row.last_event_id === 'string' ? row.last_event_id : null,
    lastCursor: typeof row.last_cursor === 'string' ? row.last_cursor : null,
    lastExecutedAt: typeof row.last_executed_at === 'string' ? row.last_executed_at : null,
    metadata: row.metadata && typeof row.metadata === 'object'
      ? row.metadata as Record<string, unknown>
      : {},
  };
}

function shouldReplaceCheckpoint(
  current: ToriiEventCheckpoint | null,
  next: SaveToriiEventCheckpointInput
): boolean {
  if (!current) {
    return true;
  }

  if (next.lastEventId && next.lastEventId === current.lastEventId) {
    return Boolean(next.lastCursor) && !current.lastCursor;
  }

  const currentTime = current.lastExecutedAt ? Date.parse(current.lastExecutedAt) : 0;
  const nextTime = next.lastExecutedAt ? Date.parse(next.lastExecutedAt) : 0;

  if (nextTime > currentTime) {
    return true;
  }

  // Multiple Torii events can share the same second-level executed_at. The
  // caller processes catch-up pages oldest to newest, so allow same-second
  // advancement instead of comparing opaque event ids.
  return nextTime === currentTime && Boolean(next.lastEventId || next.lastCursor);
}

export async function loadToriiEventCheckpoint(checkpointKey: string): Promise<ToriiEventCheckpoint | null> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      '[torii-checkpoint] storage=supabase required=true missing=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  try {
    const { data, error } = await supabase
      .from(CHECKPOINT_TABLE)
      .select('*')
      .eq('checkpoint_key', checkpointKey)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const checkpoint = data ? fromRow(data as Record<string, unknown>) : null;
    if (checkpoint) {
      memoryCheckpoints.set(checkpointKey, checkpoint);
    } else {
      memoryCheckpoints.delete(checkpointKey);
    }
    return checkpoint;
  } catch (error) {
    throw checkpointStorageError('load', error);
  }
}

export async function assertToriiEventCheckpointStorage(): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      '[torii-checkpoint] storage=supabase required=true missing=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  try {
    const { error } = await supabase
      .from(CHECKPOINT_TABLE)
      .select('checkpoint_key')
      .limit(1);

    if (error) {
      throw error;
    }
  } catch (error) {
    throw checkpointStorageError('verify', error);
  }
}

export async function saveToriiEventCheckpoint(input: SaveToriiEventCheckpointInput): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      '[torii-checkpoint] storage=supabase required=true missing=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  const current = memoryCheckpoints.get(input.checkpointKey)
    ?? await loadToriiEventCheckpoint(input.checkpointKey);
  if (!shouldReplaceCheckpoint(current, input)) {
    return;
  }

  const next: ToriiEventCheckpoint = {
    checkpointKey: input.checkpointKey,
    slotEnv: input.slotEnv,
    worldAddress: input.worldAddress,
    listenerName: input.listenerName,
    lastEventId: input.lastEventId,
    lastCursor: input.lastCursor,
    lastExecutedAt: input.lastExecutedAt,
    metadata: input.metadata,
  };

  try {
    const { error } = await supabase
      .from(CHECKPOINT_TABLE)
      .upsert({
        checkpoint_key: input.checkpointKey,
        slot_env: input.slotEnv,
        world_address: input.worldAddress,
        listener_name: input.listenerName,
        last_event_id: input.lastEventId,
        last_cursor: input.lastCursor,
        last_executed_at: input.lastExecutedAt,
        metadata: input.metadata,
      }, { onConflict: 'checkpoint_key' });

    if (error) {
      throw error;
    }

    memoryCheckpoints.set(input.checkpointKey, next);
  } catch (error) {
    throw checkpointStorageError('save', error);
  }
}
