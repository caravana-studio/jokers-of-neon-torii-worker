import { supabase } from '../config/supabase.js';
import type { MissionCompletedEventData } from '../blockchainEventHandlers.js';
import type { QueuedIntent, TransactionResult } from '../transactionQueueTypes.js';

const SECONDS_IN_DAY = 86400;
const DAY_START_OFFSET_SECONDS = 21600; // 6am UTC = 3am Argentina time.
const MAX_STARKNET_ADDRESS = (1n << 251n) - 1n;

type StreakSyncStatus = 'confirmed' | 'pending' | 'failed';

type PlayerStreakRow = {
  player_address: string;
  username: string | null;
  current_streak: number;
  effective_streak: number;
  longest_streak: number;
  last_completed_day: number | string;
  protectors_available: number;
  protectors_needed: number | string;
  days_missed: number | string;
  is_protected: boolean;
  is_broken: boolean;
  sync_status: StreakSyncStatus;
  pending_period_id: number | string | null;
  pending_mission_id: string | null;
  pending_template_id: string | null;
};

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeStarknetAddress(address: string): string {
  const raw = String(address ?? '').trim();
  if (!raw) {
    throw new Error('Address is required');
  }

  let value: bigint;
  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    value = BigInt(raw);
  } else if (/^[0-9]+$/.test(raw)) {
    value = BigInt(raw);
  } else if (/^[0-9a-fA-F]+$/.test(raw)) {
    value = BigInt(`0x${raw}`);
  } else {
    throw new Error(`Invalid Starknet address: ${address}`);
  }

  if (value < 0n || value > MAX_STARKNET_ADDRESS) {
    throw new Error(`Invalid Starknet address: ${address}`);
  }

  return `0x${value.toString(16).padStart(64, '0')}`;
}

function getCurrentDailyPeriodId(date = new Date()): number {
  return Math.floor((Math.floor(date.getTime() / 1000) - DAY_START_OFFSET_SECONDS) / SECONDS_IN_DAY);
}

function calculateEffectiveStreak(input: {
  currentStreak: number;
  lastCompletedDay: number;
  protectorsAvailable: number;
}) {
  const currentDay = getCurrentDailyPeriodId();
  const hasStarted = input.currentStreak > 0 && input.lastCompletedDay > 0;
  const daysMissed =
    hasStarted && currentDay > input.lastCompletedDay
      ? Math.max(0, currentDay - input.lastCompletedDay - 1)
      : 0;
  const isProtected = hasStarted && daysMissed > 0 && daysMissed <= input.protectorsAvailable;
  const isBroken = hasStarted && daysMissed > input.protectorsAvailable;
  const effectiveStreak = isBroken ? 0 : input.currentStreak;

  return {
    daysMissed,
    protectorsNeeded: daysMissed,
    isProtected,
    isBroken,
    effectiveStreak,
  };
}

async function getUsername(playerAddress: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('usernames')
    .select('username')
    .eq('address', playerAddress)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01') {
      return null;
    }
    console.warn('[StreakCache] Could not read username', { playerAddress, error });
    return null;
  }

  return typeof data?.username === 'string' ? data.username : null;
}

async function getStreakRow(playerAddress: string): Promise<PlayerStreakRow | null> {
  const { data, error } = await supabase
    .from('player_streaks')
    .select('*')
    .eq('player_address', playerAddress)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01') {
      console.warn(
        '[StreakCache] player_streaks table missing; run supabase/migrations/20260526120000_create_player_streaks_tables.sql'
      );
      return null;
    }
    throw error;
  }

  return data as PlayerStreakRow | null;
}

async function insertStreakEvent(input: {
  playerAddress: string;
  eventType: string;
  periodId?: number;
  missionId?: string;
  templateId?: string;
  currentStreak?: number;
  protectorsUsed?: number;
  protectorsAvailable?: number;
  txHash?: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await supabase.from('player_streak_events').insert({
    player_address: input.playerAddress,
    event_type: input.eventType,
    period_id: input.periodId ?? null,
    mission_id: input.missionId ?? null,
    template_id: input.templateId ?? null,
    current_streak: input.currentStreak ?? null,
    protectors_used: input.protectorsUsed ?? null,
    protectors_available: input.protectorsAvailable ?? null,
    tx_hash: input.txHash ?? null,
    metadata: input.metadata ?? {},
  });

  if (error && error.code !== '42P01') {
    console.warn('[StreakCache] Could not insert streak event', error);
  }
}

export async function markDailyStreakPending(event: MissionCompletedEventData): Promise<void> {
  if (event.periodType !== 'daily' || event.periodId <= 0 || event.xp <= 0) {
    return;
  }

  try {
    const playerAddress = normalizeStarknetAddress(event.player);
    const existing = await getStreakRow(playerAddress);

    if (
      existing &&
      toNumber(existing.pending_period_id) === event.periodId &&
      existing.sync_status === 'pending'
    ) {
      return;
    }

    if (existing && event.periodId <= toNumber(existing.last_completed_day)) {
      return;
    }

    const currentStreak = existing ? toNumber(existing.current_streak) : 0;
    const longestStreak = existing ? toNumber(existing.longest_streak) : 0;
    const lastCompletedDay = existing ? toNumber(existing.last_completed_day) : 0;
    const protectorsAvailable = existing ? toNumber(existing.protectors_available) : 0;
    const missedDays =
      currentStreak > 0 && lastCompletedDay > 0
        ? Math.max(0, event.periodId - lastCompletedDay - 1)
        : 0;
    const protectorsUsed = Math.min(protectorsAvailable, missedDays);
    const hasEnoughProtectors = missedDays <= protectorsAvailable;
    const nextStreak =
      currentStreak <= 0
        ? 1
        : missedDays === 0 || hasEnoughProtectors
        ? currentStreak + 1
        : 1;
    const nextProtectors = Math.max(0, protectorsAvailable - protectorsUsed);
    const effective = calculateEffectiveStreak({
      currentStreak: nextStreak,
      lastCompletedDay: event.periodId,
      protectorsAvailable: nextProtectors,
    });
    const username = existing?.username ?? (await getUsername(playerAddress));

    const { error } = await supabase.from('player_streaks').upsert(
      {
        player_address: playerAddress,
        username,
        current_streak: nextStreak,
        effective_streak: effective.effectiveStreak,
        longest_streak: Math.max(longestStreak, nextStreak),
        last_completed_day: event.periodId,
        protectors_available: nextProtectors,
        protectors_needed: effective.protectorsNeeded,
        days_missed: effective.daysMissed,
        is_protected: effective.isProtected,
        is_broken: effective.isBroken,
        sync_status: 'pending',
        pending_period_id: event.periodId,
        pending_mission_id: event.missionId || null,
        pending_template_id: event.templateId || null,
      },
      { onConflict: 'player_address' }
    );

    if (error) {
      if (error.code === '42P01') {
        console.warn('[StreakCache] player_streaks table missing; skip pending streak cache');
        return;
      }
      throw error;
    }

    await insertStreakEvent({
      playerAddress,
      eventType: 'daily_mission_pending',
      periodId: event.periodId,
      missionId: event.missionId,
      templateId: event.templateId,
      currentStreak: nextStreak,
      protectorsUsed,
      protectorsAvailable: nextProtectors,
      metadata: {
        gameId: event.gameId,
        xp: event.xp,
        target: event.target,
        progress: event.progress,
      },
    });
  } catch (error) {
    console.warn('[StreakCache] Could not mark daily streak pending', error);
  }
}

function getDailyMissionPayload(intent: QueuedIntent) {
  if (intent.operation !== 'xp.mission_completed') {
    return null;
  }

  const periodType = String(intent.payload.periodType ?? '');
  const periodTypeId = toNumber(intent.payload.periodTypeId);
  const periodId = toNumber(intent.payload.periodId);

  if (periodType !== 'daily' && periodTypeId !== 1) {
    return null;
  }

  if (periodId <= 0) {
    return null;
  }

  return {
    playerAddress: normalizeStarknetAddress(String(intent.payload.player ?? '')),
    periodId,
    missionId: String(intent.payload.missionId ?? ''),
    templateId: String(intent.payload.templateId ?? ''),
  };
}

export async function markDailyStreakTransactionCompleted(
  intent: QueuedIntent,
  result: TransactionResult
): Promise<void> {
  const payload = getDailyMissionPayload(intent);
  if (!payload) {
    return;
  }

  try {
    const existing = await getStreakRow(payload.playerAddress);
    const currentStreak = Math.max(1, existing ? toNumber(existing.current_streak) : 1);
    const longestStreak = Math.max(currentStreak, existing ? toNumber(existing.longest_streak) : 0);
    const lastCompletedDay = Math.max(payload.periodId, existing ? toNumber(existing.last_completed_day) : 0);
    const protectorsAvailable = existing ? toNumber(existing.protectors_available) : 0;
    const effective = calculateEffectiveStreak({
      currentStreak,
      lastCompletedDay,
      protectorsAvailable,
    });

    const { data, error } = await supabase
      .from('player_streaks')
      .update({
        current_streak: currentStreak,
        effective_streak: effective.effectiveStreak,
        longest_streak: longestStreak,
        last_completed_day: lastCompletedDay,
        protectors_available: protectorsAvailable,
        protectors_needed: effective.protectorsNeeded,
        days_missed: effective.daysMissed,
        is_protected: effective.isProtected,
        is_broken: effective.isBroken,
        sync_status: 'confirmed',
        pending_period_id: null,
        pending_mission_id: null,
        pending_template_id: null,
        last_tx_hash: result.transactionHash ?? null,
        last_synced_at: new Date().toISOString(),
      })
      .eq('player_address', payload.playerAddress)
      .eq('pending_period_id', payload.periodId)
      .select('*')
      .maybeSingle();

    if (error) {
      if (error.code === '42P01') {
        return;
      }
      throw error;
    }

    if (!data) {
      const username = existing?.username ?? (await getUsername(payload.playerAddress));
      const { error: upsertError } = await supabase.from('player_streaks').upsert(
        {
          player_address: payload.playerAddress,
          username,
          current_streak: currentStreak,
          effective_streak: effective.effectiveStreak,
          longest_streak: longestStreak,
          last_completed_day: lastCompletedDay,
          protectors_available: protectorsAvailable,
          protectors_needed: effective.protectorsNeeded,
          days_missed: effective.daysMissed,
          is_protected: effective.isProtected,
          is_broken: effective.isBroken,
          sync_status: 'confirmed',
          pending_period_id: null,
          pending_mission_id: null,
          pending_template_id: null,
          last_tx_hash: result.transactionHash ?? null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'player_address' }
      );

      if (upsertError && upsertError.code !== '42P01') {
        throw upsertError;
      }
    }

    await insertStreakEvent({
      playerAddress: payload.playerAddress,
      eventType: 'daily_mission_confirmed',
      periodId: payload.periodId,
      missionId: payload.missionId,
      templateId: payload.templateId,
      currentStreak,
      protectorsAvailable,
      txHash: result.transactionHash,
    });
  } catch (error) {
    console.warn('[StreakCache] Could not confirm daily streak cache', error);
  }
}

export async function markDailyStreakTransactionFailed(
  intent: QueuedIntent,
  errorMessage?: string
): Promise<void> {
  const payload = getDailyMissionPayload(intent);
  if (!payload) {
    return;
  }

  try {
    const { error } = await supabase
      .from('player_streaks')
      .update({
        sync_status: 'failed',
        last_synced_at: new Date().toISOString(),
      })
      .eq('player_address', payload.playerAddress)
      .eq('pending_period_id', payload.periodId);

    if (error && error.code !== '42P01') {
      throw error;
    }

    await insertStreakEvent({
      playerAddress: payload.playerAddress,
      eventType: 'daily_mission_failed',
      periodId: payload.periodId,
      missionId: payload.missionId,
      templateId: payload.templateId,
      metadata: {
        error: errorMessage ?? null,
      },
    });
  } catch (error) {
    console.warn('[StreakCache] Could not fail daily streak cache', error);
  }
}
