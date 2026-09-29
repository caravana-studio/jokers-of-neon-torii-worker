/** Pure, versioned reducer. The commit RPC owns locks, CAS, ledger and receipts. */
export const PROCESSOR_VERSION = 'gameplay-v1';
export interface Fact {
  sequence: string; kind: string; amount: number; subject: number; detail: number; flags: number;
}
export const FACT_KINDS = new Set(['hand_played', 'card_added', 'card_bought', 'special_bought',
  'lootbox_opened', 'level_completed', 'round_won', 'cards_burned', 'rage_defeated', 'slot_bought',
  'hand_upgraded', 'special_sold', 'powerups_used', 'shop_rerolled', 'powerup_sold', 'run_finished']);
export interface ProgressionRules {
  processor: typeof PROCESSOR_VERSION; calendar_key: string; xp_multiplier: number;
  level_xp: Record<string, number[]>; season_thresholds: number[]; profile_thresholds: number[];
  run_completion_level: number; max_unlocks_per_run: number; mission_slots: { day: number; week: number };
  tiers: { key: string; runs: number; level: number; round: number }[];
}
export interface Mission {
  assignment_id: string; kind: 'day' | 'week'; progress: string; game_progress: string;
  target: string; objective: { metric: string; aggregate: 'sum' | 'max' };
  reward: { xp: number };
}
export interface Snapshot {
  event_id: string; game_id: string | null; fact: Fact; rules: ProgressionRules;
  profile: { version: string; tier: number; highest_level: number; highest_round: number;
    completed_games: string; lifetime_xp: string; level: number };
  season: { xp: string; level: number; eligible: boolean };
  day: { period_id: string; ordinal: string };
  level_completions: number;
  missions: Mission[];
  streak: { current_length: number; longest_length: number; last_ordinal: string | null };
  protectors: { account_id: string; revision: string; balance: string } | null;
  // Pre-materialized calendar periods; a missing day must block protection, never burn a token silently.
  gap_periods: { period_id: string; ordinal: string }[];
}
export interface Effects {
  profile: Snapshot['profile']; season_level: number;
  level_completion: boolean;
  xp: { cause: string; amount: string }[];
  unlocks: string[];
  missions: { assignment_id: string; progress: string; game_progress: string | null;
    delta: string; completed: boolean }[];
  streak: null | { current_length: number; longest_length: number; last_ordinal: string;
    reset: boolean; protected_period_ids: string[]; used: number };
}
const positive = (x: number) => Number.isSafeInteger(x) && x >= 0;
function validateRules(r: ProgressionRules) {
  if (!r || r.processor !== PROCESSOR_VERSION || !r.calendar_key || !positive(r.xp_multiplier)
    || r.xp_multiplier === 0 || !positive(r.max_unlocks_per_run) || r.max_unlocks_per_run > 22
    || !positive(r.run_completion_level) || !Array.isArray(r.tiers)
    || !r.tiers.every(t => t.key && positive(t.runs) && positive(t.level) && positive(t.round))
    || !r.level_xp || !Object.values(r.level_xp).every(a => Array.isArray(a) && a.every(positive)))
    throw new Error('INVALID_PROGRESSION_RULES');
  for (const thresholds of [r.profile_thresholds, r.season_thresholds]) {
    if (!Array.isArray(thresholds) || thresholds.length > 100 || !thresholds.every((x, i) =>
      positive(x) && x > 0 && (i === 0 || x > thresholds[i - 1]))) throw new Error('INVALID_XP_THRESHOLDS');
  }
}
function levelFor(xp: bigint, thresholds: number[]) {
  return thresholds.filter(n => xp >= BigInt(n)).length;
}
/** Measurements describe gameplay, never a mission ID or a client-supplied award. */
export function measurements(f: Fact, rules: ProgressionRules): Record<string, bigint> {
  if (!FACT_KINDS.has(f.kind)) throw new Error('UNKNOWN_GAMEPLAY_FACT');
  const m: Record<string, bigint> = {};
  const add = (key: string, n = 1) => { m[key] = BigInt(n); };
  const flag = (n: number) => (f.flags & n) !== 0;
  switch (f.kind) {
    case 'hand_played':
      add('score', f.amount);
      if (f.subject > 0) add('hand:' + f.subject);
      if (flag(1)) add('neon_hands');
      if (flag(2)) add('wild_joker_hands');
      if (f.detail > 0) {
        add(`flush:${f.detail}:${f.subject}`);
        if (flag(4)) add(`flush:${f.detail}:0`);
      }
      break;
    case 'card_added': case 'card_bought':
      add('cards_added');
      if (flag(1)) add('neon_added');
      if (flag(2)) add('modifier_added');
      if (flag(4)) add('traditional_added');
      if (flag(8)) add('joker_added');
      if (flag(16)) add('wild_added');
      if (flag(1) && flag(8)) add('neon_joker_added');
      if (flag(1) && !flag(8) && !flag(16)) add('neon_base_added');
      if (flag(32)) {
        add('suit_added:' + f.detail);
        if (flag(1)) add('neon_suit_added:' + f.detail);
      }
      if (f.kind === 'card_bought') {
        if (flag(4)) add('traditional_bought');
        if (flag(1) && flag(8)) add('neon_joker_bought');
      }
      break;
    case 'level_completed':
      add('level_reached', f.amount); add('levels_won');
      if (f.amount === rules.run_completion_level) { add('runs_completed'); add('winning_rerolls', f.subject); }
      break;
    case 'round_won': add('rounds_won'); if (flag(1)) add('rounds_no_discards'); break;
    case 'cards_burned': add('cards_burned', f.amount); add('neon_burned', f.subject); add('modifier_burned', f.detail); break;
    case 'run_finished': break;
    default: add(f.kind, f.amount);
  }
  return m;
}
const METRICS = new Set(['score','neon_hands','wild_joker_hands','cards_added','neon_added',
  'modifier_added','traditional_added','joker_added','wild_added','neon_joker_added','neon_base_added',
  'traditional_bought','neon_joker_bought','level_reached','levels_won','runs_completed',
  'winning_rerolls','rounds_won','rounds_no_discards','cards_burned','neon_burned','modifier_burned',
  'special_bought','lootbox_opened','rage_defeated','slot_bought','hand_upgraded','special_sold',
  'powerups_used','shop_rerolled','powerup_sold','daily_completed','free_packs']);
function reduceWithMeasurements(s: Snapshot, commandMetrics?: Record<string,bigint>): Effects {
  validateRules(s.rules);
  const profile = { ...s.profile };
  const effects: Effects = { profile, season_level: s.season.level, level_completion: false,
    xp: [], unlocks: [], missions: [], streak: null };
  const metrics = commandMetrics ?? measurements(s.fact, s.rules);
  if (s.fact.kind === 'run_finished' && ![0,1].includes(s.fact.flags)) throw new Error('INVALID_TERMINAL_REASON');
  const award = (cause: string, base: number) => {
    if (!positive(base)) throw new Error('INVALID_XP_REWARD');
    const amount = BigInt(base) * BigInt(s.rules.xp_multiplier) / 100n;
    if (amount > 0n) effects.xp.push({ cause, amount: amount.toString() });
    return amount;
  };
  if (s.fact.kind === 'level_completed') {
    const xp = award('level', s.rules.level_xp[s.fact.amount]?.[s.level_completions] ?? 0);
    // Profile's authoritative legacy rule increments the daily counter only if XP > 0.
    effects.level_completion = xp > 0n;
  }
  if (s.fact.kind === 'run_finished' && s.fact.flags === 1) {
    profile.completed_games = (BigInt(profile.completed_games) + 1n).toString();
    if (s.fact.amount > profile.highest_level || (s.fact.amount === profile.highest_level && s.fact.subject > profile.highest_round)) {
      profile.highest_level = s.fact.amount; profile.highest_round = s.fact.subject;
    }
    for (let i = 0; i < s.rules.max_unlocks_per_run; i++) {
      const next = s.rules.tiers[profile.tier];
      if (!next || BigInt(profile.completed_games) < BigInt(next.runs)
        || s.fact.amount < next.level || (s.fact.amount === next.level && s.fact.subject < next.round)) break;
      profile.tier++; effects.unlocks.push(next.key);
    }
  }
  let streakQualified = false;
  // Daily completions contribute to the weekly mission in this same transaction.
  const missions = [...s.missions].sort((a, b) => (a.kind === 'day' ? 0 : 1) - (b.kind === 'day' ? 0 : 1));
  for (const mission of missions) {
    const { metric, aggregate } = mission.objective;
    if ((!METRICS.has(metric) && !/^(hand:[1-9][0-9]*|(?:neon_)?suit_added:[1-4]|flush:[1-4]:[0-9]+)$/.test(metric))
      || !['sum','max'].includes(aggregate)) throw new Error('UNKNOWN_MISSION_OBJECTIVE');
    const amount = metrics[metric] ?? 0n;
    if (amount === 0n) continue;
    const current = BigInt(mission.kind === 'day' ? mission.game_progress : mission.progress);
    const next = aggregate === 'max' ? (amount > current ? amount : current) : current + amount;
    if (next === current) continue;
    const target = BigInt(mission.target);
    const completed = next >= target;
    effects.missions.push({ assignment_id: mission.assignment_id, progress: next.toString(),
      game_progress: mission.kind === 'day' ? next.toString() : null,
      delta: (next - current).toString(), completed });
    if (completed) {
      if (Object.keys(mission.reward).some(k => k !== 'xp')) throw new Error('UNSUPPORTED_MISSION_REWARD');
      const xp = award('mission:' + mission.assignment_id, mission.reward.xp);
      if (mission.kind === 'day') {
        metrics.daily_completed = (metrics.daily_completed ?? 0n) + 1n;
        streakQualified ||= xp > 0n;
      }
    }
  }
  const xp = effects.xp.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
  profile.lifetime_xp = (BigInt(profile.lifetime_xp) + xp).toString();
  profile.level = Math.max(profile.level, levelFor(BigInt(profile.lifetime_xp), s.rules.profile_thresholds));
  if (s.season.eligible) effects.season_level = Math.max(s.season.level, levelFor(BigInt(s.season.xp) + xp, s.rules.season_thresholds));
  if (streakQualified && (s.streak.last_ordinal === null || BigInt(s.day.ordinal) > BigInt(s.streak.last_ordinal))) {
    const missed = s.streak.last_ordinal === null ? 0n : BigInt(s.day.ordinal) - BigInt(s.streak.last_ordinal) - 1n;
    const available = BigInt(s.protectors?.balance ?? '0');
    const used = Number(missed < available ? missed : available);
    if (!Number.isSafeInteger(used) || used > 65535) throw new Error('INVALID_PROTECTOR_BALANCE');
    const reset = missed > available;
    const current = Math.min(65535, (reset ? 0 : s.streak.current_length) + 1);
    const protectedIds: string[] = [];
    for (let i = 1; i <= used; i++) {
      const ordinal = (BigInt(s.streak.last_ordinal!) + BigInt(i)).toString();
      const period = s.gap_periods.find(p => p.ordinal === ordinal);
      if (!period) throw new Error('MISSING_STREAK_PERIOD');
      protectedIds.push(period.period_id);
    }
    effects.streak = { current_length: current, longest_length: Math.max(current, s.streak.longest_length),
      last_ordinal: s.day.ordinal, reset, protected_period_ids: protectedIds, used };
  }
  return effects;
}

export function reduceProgression(s: Snapshot): Effects {
  return reduceWithMeasurements(s);
}
/** Only the command journal may supply this fact; the Core parser still rejects it. */
export function reduceFreePackProgression(s: Snapshot): Effects {
  if (s.game_id !== null || s.fact.kind !== 'free_pack_claimed' || s.fact.amount !== 1
    || s.missions.some(m => m.kind !== 'week' || m.objective.metric !== 'free_packs' || m.objective.aggregate !== 'sum'))
    throw new Error('INVALID_FREE_PACK_FACT');
  return reduceWithMeasurements(s, {free_packs:1n});
}
