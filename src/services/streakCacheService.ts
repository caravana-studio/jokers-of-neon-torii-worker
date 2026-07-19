import { isSupabaseConfigured, supabase } from '../config/supabase.js';
import type { MissionCompletedEventData } from '../blockchainEventHandlers.js';
import type { QueuedIntent, TransactionResult } from '../transactionQueueTypes.js';
import { CallData, RpcProvider } from 'starknet';
import { env } from '../env.js';

const SECONDS_IN_DAY = 86400;
const DAY_START_OFFSET_SECONDS = 21600; // 6am UTC = 3am Argentina time.
const MAX_STARKNET_ADDRESS = (1n << 251n) - 1n;
const IGNORED_STREAK_USERNAME_PATTERN = /^(joker_guest_[0-9]+|guest_?[a-z0-9]+|burner[0-9]+)$/i;

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
  pending_intent_id: string | null;
  last_tx_hash?: string | null;
  last_synced_at?: string | null;
  updated_at?: string | null;
};

export type DailyStreakPendingMutation = {
  streak: {
    player_address: string;
    username: string;
    current_streak: number;
    effective_streak: number;
    longest_streak: number;
    last_completed_day: number;
    protectors_available: number;
    protectors_needed: number;
    days_missed: number;
    is_protected: boolean;
    is_broken: boolean;
    sync_status: 'pending';
    pending_period_id: number;
    pending_mission_id: string | null;
    pending_template_id: string | null;
  };
  event: {
    player_address: string;
    event_type: 'daily_mission_pending';
    period_id: number;
    mission_id: string | null;
    template_id: string | null;
    current_streak: number;
    protectors_used: number;
    protectors_available: number;
    metadata: Record<string, unknown>;
  };
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

function compactStarknetAddress(address: string): string {
  return `0x${BigInt(normalizeStarknetAddress(address)).toString(16)}`;
}

function getCurrentDailyPeriodId(date = new Date()): number {
  return Math.floor((Math.floor(date.getTime() / 1000) - DAY_START_OFFSET_SECONDS) / SECONDS_IN_DAY);
}

export function calculateEffectiveStreak(input: {
  currentStreak: number;
  lastCompletedDay: number;
  protectorsAvailable: number;
  currentDay?: number;
}) {
  const currentDay = input.currentDay ?? getCurrentDailyPeriodId();
  const hasStarted = input.currentStreak > 0 && input.lastCompletedDay > 0;
  const daysMissed =
    hasStarted && currentDay > input.lastCompletedDay
      ? Math.max(0, currentDay - input.lastCompletedDay - 1)
      : 0;
  const isProtected = hasStarted && daysMissed > 0 && daysMissed <= input.protectorsAvailable;
  const isBroken = hasStarted && daysMissed > input.protectorsAvailable;
  const effectiveStreak = isBroken ? 0 : input.currentStreak;
  const protectorsUsed = Math.min(input.protectorsAvailable, daysMissed);
  const protectorsRemaining = Math.max(0, input.protectorsAvailable - protectorsUsed);
  const effectiveLastCompletedDay =
    hasStarted && daysMissed > 0 ? Math.max(0, currentDay - 1) : input.lastCompletedDay;

  return {
    daysMissed,
    protectorsNeeded: daysMissed,
    isProtected,
    isBroken,
    effectiveStreak,
    protectorsAvailable: protectorsRemaining,
    lastCompletedDay: effectiveLastCompletedDay,
    protectorsUsed,
  };
}

function isMissingSupabaseTable(error: { code?: string; message?: string; details?: string }): boolean {
  const details = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    details.includes('schema cache') ||
    details.includes('could not find the table')
  );
}

function isIgnoredStreakUsername(username: string | null | undefined): boolean {
  const normalized = String(username ?? '').trim();
  return !normalized || IGNORED_STREAK_USERNAME_PATTERN.test(normalized);
}

async function getUsername(playerAddress: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('usernames')
    .select('username')
    .eq('address', playerAddress)
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) {
      return null;
    }
    console.warn('[StreakCache] Could not read username', { playerAddress, error });
    return null;
  }

  return typeof data?.username === 'string' ? data.username : null;
}

async function getBurnerOwnerAddress(playerAddress: string): Promise<string | null> {
  const addressCandidates = Array.from(
    new Set([
      normalizeStarknetAddress(playerAddress).toLowerCase(),
      compactStarknetAddress(playerAddress).toLowerCase(),
    ])
  );
  const { data, error } = await supabase
    .from('user_burners')
    .select('user_wallet')
    .in('burner_address', addressCandidates)
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) {
      return null;
    }
    console.warn('[StreakCache] Could not resolve burner owner for streak cache', {
      playerAddress,
      error,
    });
    return null;
  }

  return typeof data?.user_wallet === 'string' ? data.user_wallet : null;
}

async function resolveStreakUsername(playerAddress: string): Promise<string | null> {
  const directUsername = await getUsername(playerAddress);
  if (directUsername && !isIgnoredStreakUsername(directUsername)) {
    return directUsername;
  }

  const ownerAddress = await getBurnerOwnerAddress(playerAddress);
  if (!ownerAddress) {
    return null;
  }

  const ownerUsername = await getUsername(normalizeStarknetAddress(ownerAddress));
  if (isIgnoredStreakUsername(ownerUsername)) {
    return null;
  }

  return ownerUsername;
}

async function getStreakRow(playerAddress: string): Promise<PlayerStreakRow | null> {
  const { data, error } = await supabase
    .from('player_streaks')
    .select('*')
    .eq('player_address', playerAddress)
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) {
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

  if (error && !isMissingSupabaseTable(error)) {
    console.warn('[StreakCache] Could not insert streak event', error);
  }
}

export async function prepareDailyStreakPending(
  event: MissionCompletedEventData
): Promise<DailyStreakPendingMutation | null> {
  if (event.periodType !== 'daily' || event.periodId <= 0 || event.xp <= 0) {
    return null;
  }

  try {
    const playerAddress = normalizeStarknetAddress(event.player);
    const existing = await getStreakRow(playerAddress);

    if (
      existing &&
      toNumber(existing.pending_period_id) === event.periodId &&
      existing.sync_status === 'pending'
    ) {
      return null;
    }

    if (existing && event.periodId <= toNumber(existing.last_completed_day)) {
      return null;
    }

    const currentStreak = existing ? toNumber(existing.current_streak) : 0;
    const longestStreak = existing ? toNumber(existing.longest_streak) : 0;
    const lastCompletedDay = existing ? toNumber(existing.last_completed_day) : 0;
    const protectorsAvailable = existing ? toNumber(existing.protectors_available) : 0;
    const resolvedGap = calculateEffectiveStreak({
      currentStreak,
      lastCompletedDay,
      protectorsAvailable,
      currentDay: event.periodId,
    });
    const nextStreak =
      currentStreak <= 0
        ? 1
        : resolvedGap.effectiveStreak + 1;
    const nextProtectors = resolvedGap.protectorsAvailable;
    const effective = calculateEffectiveStreak({
      currentStreak: nextStreak,
      lastCompletedDay: event.periodId,
      protectorsAvailable: nextProtectors,
    });
    const username =
      existing && !isIgnoredStreakUsername(existing.username)
        ? existing.username
        : await resolveStreakUsername(playerAddress);

    if (!username) {
      console.log(`[StreakCache] Skipping streak cache for player without real username: ${playerAddress}`);
      return null;
    }

    return {
      streak: {
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
      event: {
        player_address: playerAddress,
        event_type: 'daily_mission_pending',
        period_id: event.periodId,
        mission_id: event.missionId || null,
        template_id: event.templateId || null,
        current_streak: nextStreak,
        protectors_used: resolvedGap.protectorsUsed,
        protectors_available: nextProtectors,
        metadata: {
          gameId: event.gameId,
          xp: event.xp,
          target: event.target,
          progress: event.progress,
        },
      },
    };
  } catch (error) {
    console.warn('[StreakCache] Could not prepare daily streak pending state', error);
    return null;
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

function parseStreakStatusResult(result: string[]) {
  let offset = 0;
  return {
    player: String(result[offset++]),
    currentStreak: toNumber(result[offset++]),
    longestStreak: toNumber(result[offset++]),
    lastCompletedDay: toNumber(result[offset++]),
    protectorsAvailable: toNumber(result[offset++]),
    protectorsNeeded: toNumber(result[offset++]),
    daysMissed: toNumber(result[offset++]),
    isProtected: toNumber(result[offset++]) === 1,
    isBroken: toNumber(result[offset++]) === 1,
  };
}

async function refreshDailyStreakFromChain(
  playerAddress: string,
  reason: string,
  txHash?: string
): Promise<PlayerStreakRow> {
  if (!env.BACKGROUND_STARKNET_RPC_URL || !env.XP_SYSTEM_CONTRACT_ADDRESS) {
    throw new Error('Streak reconciliation requires BACKGROUND_STARKNET_RPC_URL and XP_SYSTEM_CONTRACT_ADDRESS');
  }

  const normalizedAddress = normalizeStarknetAddress(playerAddress);
  const provider = new RpcProvider({ nodeUrl: env.BACKGROUND_STARKNET_RPC_URL });
  const result = await provider.callContract({
    contractAddress: env.XP_SYSTEM_CONTRACT_ADDRESS,
    entrypoint: 'get_streak_status',
    calldata: CallData.compile([normalizedAddress]),
  });
  const chain = parseStreakStatusResult(result);
  const existing = await getStreakRow(normalizedAddress);
  const username =
    existing && !isIgnoredStreakUsername(existing.username)
      ? existing.username
      : await resolveStreakUsername(normalizedAddress);

  if (!username) {
    throw new Error(`Could not resolve streak username for ${normalizedAddress}`);
  }

  const row = {
    player_address: normalizedAddress,
    username,
    current_streak: chain.currentStreak,
    effective_streak: chain.isBroken ? 0 : chain.currentStreak,
    longest_streak: chain.longestStreak,
    last_completed_day: chain.lastCompletedDay,
    protectors_available: chain.protectorsAvailable,
    protectors_needed: chain.protectorsNeeded,
    days_missed: chain.daysMissed,
    is_protected: chain.isProtected,
    is_broken: chain.isBroken,
    sync_status: 'confirmed' as const,
    pending_period_id: null,
    pending_mission_id: null,
    pending_template_id: null,
    pending_intent_id: null,
    last_tx_hash: txHash ?? existing?.last_tx_hash ?? null,
    last_synced_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('player_streaks')
    .upsert(row, { onConflict: 'player_address' })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  await insertStreakEvent({
    playerAddress: normalizedAddress,
    eventType: 'daily_streak_reconciled',
    periodId: chain.lastCompletedDay,
    currentStreak: chain.currentStreak,
    protectorsAvailable: chain.protectorsAvailable,
    metadata: { reason },
  });

  return data as PlayerStreakRow;
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
    const confirmed = await refreshDailyStreakFromChain(
      payload.playerAddress,
      'transaction_completed',
      result.transactionHash
    );

    await insertStreakEvent({
      playerAddress: payload.playerAddress,
      eventType: 'daily_mission_confirmed',
      periodId: payload.periodId,
      missionId: payload.missionId,
      templateId: payload.templateId,
      currentStreak: toNumber(confirmed.current_streak),
      protectorsAvailable: toNumber(confirmed.protectors_available),
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

    if (error && !isMissingSupabaseTable(error)) {
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

    await refreshDailyStreakFromChain(payload.playerAddress, 'transaction_failed');
  } catch (error) {
    console.warn('[StreakCache] Could not fail daily streak cache', error);
  }
}

type ReconciliationIntent = {
  id: string;
  status: string;
  payload: Record<string, unknown>;
};

export function shouldReconcileDailyStreakRow(input: {
  syncStatus: StreakSyncStatus;
  updatedAt?: string | null;
  intentStatus?: string | null;
  now?: number;
  staleAfterMs?: number;
}): boolean {
  if (input.syncStatus === 'confirmed') {
    return false;
  }

  if (input.syncStatus === 'failed') {
    return true;
  }

  if (input.intentStatus === 'processing' || input.intentStatus === 'submitted' || input.intentStatus === 'pending') {
    return false;
  }

  const updatedAt = Date.parse(input.updatedAt ?? '');
  const staleAfterMs = input.staleAfterMs ?? 2 * 60 * 1000;
  const isStale = !Number.isFinite(updatedAt) || (input.now ?? Date.now()) - updatedAt >= staleAfterMs;
  return isStale;
}

async function findReconciliationIntent(row: PlayerStreakRow): Promise<ReconciliationIntent | null> {
  if (row.pending_intent_id) {
    const { data, error } = await supabase
      .from('torii_worker_intent_queue')
      .select('id, status, payload')
      .eq('id', row.pending_intent_id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data as ReconciliationIntent | null;
  }

  const periodId = toNumber(row.pending_period_id);
  const { data, error } = await supabase
    .from('torii_worker_intent_queue')
    .select('id, status, payload')
    .eq('operation', 'xp.mission_completed')
    .contains('payload', { periodId })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    throw error;
  }

  return ((data ?? []) as ReconciliationIntent[]).find(intent => {
    try {
      return normalizeStarknetAddress(String(intent.payload.player ?? '')) === row.player_address;
    } catch {
      return false;
    }
  }) ?? null;
}

export async function reconcileDailyStreakCache(): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  const { data, error } = await supabase
    .from('player_streaks')
    .select('*')
    .in('sync_status', ['pending', 'failed'])
    .order('updated_at', { ascending: true })
    .limit(100);

  if (error) {
    if (!isMissingSupabaseTable(error)) {
      console.warn('[StreakCache] Could not inspect stale streak rows', error);
    }
    return;
  }

  for (const row of (data ?? []) as PlayerStreakRow[]) {
    try {
      const intent = await findReconciliationIntent(row);
      if (!shouldReconcileDailyStreakRow({
        syncStatus: row.sync_status,
        updatedAt: row.updated_at,
        intentStatus: intent?.status,
      })) {
        continue;
      }

      await refreshDailyStreakFromChain(
        row.player_address,
        `periodic_reconciliation:${intent?.status ?? 'missing_intent'}`
      );
    } catch (reconciliationError) {
      console.warn('[StreakCache] Could not reconcile streak row', reconciliationError);
    }
  }
}

export function startDailyStreakReconciler(
  intervalMs = 60_000
): () => void {
  if (!isSupabaseConfigured()) {
    return () => undefined;
  }

  void reconcileDailyStreakCache();
  const timer = setInterval(() => {
    void reconcileDailyStreakCache();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
