import { FACT_KINDS, type Fact } from './progression.js';
import { parseGlobalGameId, type HistoricalGame } from '../durable/terminalResults.js';
function uint(value: unknown, max: bigint): bigint {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || (typeof value === 'number' && !Number.isSafeInteger(value))
    || !/^(0x[0-9a-f]+|[0-9]+)$/i.test(String(value))) throw new Error('INVALID_FACT_INTEGER');
  const n = BigInt(value);
  if (n > max) throw new Error('FACT_INTEGER_OUT_OF_RANGE');
  return n;
}
export function parseGameplayFact(raw: Record<string, unknown>, runtimeId: string, game: HistoricalGame) {
  if (game.runtime_id !== runtimeId || uint(raw.runtime_id, (1n<<128n)-1n) !== BigInt('0x'+runtimeId.replaceAll('-','')))
    throw new Error('EVENT_RUNTIME_MISMATCH');
  if (uint(raw.player, (1n<<251n)-1n) !== BigInt(game.player_account)) throw new Error('EVENT_PLAYER_MISMATCH');
  const sequence = uint(raw.sequence, 9223372036854775807n).toString();
  if (sequence === '0') throw new Error('INVALID_FACT_SEQUENCE');
  const kindHex = uint(raw.kind, (1n<<248n)-1n).toString(16).padStart(2,'0');
  const kind = Buffer.from(kindHex.length % 2 ? '0'+kindHex : kindHex,'hex').toString('utf8');
  if (!FACT_KINDS.has(kind)) throw new Error('UNKNOWN_GAMEPLAY_FACT');
  const fact: Fact = { sequence, kind,
    amount: Number(uint(raw.amount, 4294967295n)), subject: Number(uint(raw.subject, 4294967295n)),
    detail: Number(uint(raw.detail, 4294967295n)), flags: Number(uint(raw.flags, 63n)) };
  const timestamp = Number(uint(raw.occurred_at,253402300799n));
  if (!timestamp) throw new Error('MISSING_SOURCE_TIMESTAMP');
  return { gameId: parseGlobalGameId(raw.game_id), fact, occurredAt: new Date(timestamp*1000).toISOString() };
}
