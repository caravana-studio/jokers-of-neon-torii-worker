# Unified worker — test environment checklist

Deploy one Background Worker with `MANIFEST_SLOT_ENV` pointing at your **test/staging** slot. Use test Supabase, Firebase, and `DATA_API_URL`. Do not cut over prod until every item passes.

## Environment

- [ ] `MANIFEST_SLOT_ENV` = test slot (e.g. `dev`, `season3dev`)
- [ ] `STARKNET_PRIVATE_KEY` / `STARKNET_ADDRESS` (operational account for queue + missions)
- [ ] `SUPABASE_URL` + `SUPABASE_ANON_KEY` (test project)
- [ ] `TORII_LISTENER_ENABLED=true`
- [ ] `TRANSACTION_QUEUE_ENABLED=true`
- [ ] `CRON_JOBS_ENABLED=true`
- [ ] `MISSIONS_GENERATION_ENABLED=true`
- [ ] `GENERATE_DAILY_MISSIONS_ENABLED=true`
- [ ] `GENERATE_WEEKLY_MISSIONS_ENABLED=true`
- [ ] `NOTIFICATIONS_ENABLED=true` (only if testing push; requires Firebase)
- [ ] `GAME_AGENT_ENABLED=true` (only if testing burners; requires `BURNER_ACCOUNTS`)

## Functional checks

| # | Check | How |
|---|--------|-----|
| 1 | Process starts | `bun run build && bun run start` — no fatal errors |
| 2 | Scheduler | Logs `[scheduler] Generate Daily/Weekly Missions`, pack jobs if enabled |
| 3 | Torii | Events logged when playing a game on test slot |
| 4 | Queue | Intents move `pending` → `completed` in `torii_worker_intent_queue` |
| 5 | Daily missions | After daily cron or manual enqueue: today's missions exist (API / on-chain) |
| 6 | Weekly missions | After weekly cron or manual enqueue: week missions exist |
| 7 | Packs | If `PACK_DISTRIBUTION_ENABLED`: `pack.claimable.add` intents enqueued |
| 8 | Notifications | Missions reminder, free packs, custom (sandbox FCM) |
| 9 | Agent | Burner completes a game without blocking Torii |
| 10 | Stability | 24h+ single process, no duplicate crons / memory runaway |

## Manual mission triggers (optional)

With queue enabled and non-readonly Starknet config:

```bash
bun run trigger-missions          # both daily + weekly
bun run trigger-missions daily
bun run trigger-missions weekly
```

## Prod cutover

1. Deploy unified worker to prod with prod env.
2. Verify checklist on prod smoke (read-only Torii first if preferred).
3. Stop legacy Render workers: `jokers-of-neon-cron`, `jokers-of-neon-agent`, old `torii-worker` instance.
