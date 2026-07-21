export interface ToriiEventCheckpointPosition {
  lastEventId: string | null;
  lastCursor: string | null;
  lastExecutedAt: string | null;
}

export type ToriiEventCheckpointSource = 'live' | 'catchup' | 'checkpoint_init';

export function shouldLogEmptyCheckpointInitialization(reason: string): boolean {
  return reason !== 'periodic';
}

export function shouldPersistToriiEventCheckpoint(
  source: ToriiEventCheckpointSource,
  cursor: string | null
): boolean {
  return source !== 'live' || Boolean(cursor);
}

export function shouldReplaceToriiEventCheckpoint(
  current: ToriiEventCheckpointPosition | null,
  next: ToriiEventCheckpointPosition
): boolean {
  if (!current) {
    return true;
  }

  const currentTime = current.lastExecutedAt ? Date.parse(current.lastExecutedAt) : 0;
  const nextTime = next.lastExecutedAt ? Date.parse(next.lastExecutedAt) : 0;

  // Torii event messages are mutable entities. A game keeps the same event
  // message id while CurrentHand, MissionCompleted and PlayWin models are
  // appended to it, and GraphQL returns a new cursor/executed_at for that same
  // id. Treat that as checkpoint progress instead of pinning the checkpoint to
  // the first version of the entity forever.
  if (next.lastEventId && next.lastEventId === current.lastEventId) {
    if (nextTime > currentTime) {
      return true;
    }

    return nextTime === currentTime
      && Boolean(next.lastCursor)
      && next.lastCursor !== current.lastCursor;
  }

  if (nextTime > currentTime) {
    return true;
  }

  // Multiple Torii events can share the same second-level executed_at. The
  // caller processes catch-up pages oldest to newest, so allow same-second
  // advancement instead of comparing opaque event ids.
  return nextTime === currentTime && Boolean(next.lastEventId || next.lastCursor);
}
