# Celo Profile mirror

Production is prepared with **both switches off**. The target is the existing
Profile `0x0BEC4a42013165956949a26ea82c4366135bd297` on Celo mainnet (42220).
Legacy remains under operator control and must stop before activation: it uses
the same owner/signer as the V2 NFT executor.

## Configuration

Set `JOKERS_V2_PROFILE_MIRRORS_JSON` to the JSON array in
`config/celo-profile-mirror.production.disabled.json`. This is a public deployment
manifest: it references an existing executor and contains no signer or service key.
Leave the existing `JOKERS_V2_SETTLEMENT_CONFIG_JSON` unchanged. An inline
`executors[].profileMirror` also works; do not configure both for one executor.
Missing `enabled` means off; only the boolean `true` opts in.

Apply API migration `20261103113650_v2_celo_profile_mirror.sql` and its
`database-v2/environments/celo-season1-production-profile-mirror.sql` installation.
The DB switch is independently `false`. With the config disabled, the publisher
is not instantiated: no Profile RPCs, queue capture, signing, nonce reservations
or broadcasts. With only the DB switch disabled, retries cannot broadcast either.
Already broadcast transactions cannot be recalled by either switch.

The enabled publisher shares the NFT processing lease and generic submission
tables. NFTs get first choice of the next nonce. It persists signed bytes before
sending and retries the same transaction after crashes or lost RPC responses.
Unknown consumed nonces, reverted receipts and reorgs quarantine the shared
executor for reconciliation rather than risking duplicate additive stats.

## Later activation — requires the operator's cutover

1. Stop the legacy Profile writer and drain its signed/pending transactions.
   Confirm no other service uses signer
   `0xd9a5e955603c9a68a553ab9bd676f31c547572a6` outside this shared V2 lane.
2. Recheck Celo chain ID, contract owner, signer gas, NFT executor status, and
   pending/latest nonces. Verify the configured runtime identity and that all
   historical terminal snapshots are still readable. This publisher reads the
   existing runtime for terminal games; keep that runtime available until capture.
3. Check V2 game IDs against `getGameData` on the existing Profile. The contract
   has no runtime namespace: collisions are rejected rather than overwritten.
   IDs/counters above `uint32` and tiers above `uint8` are rejected, never truncated.
4. Keep the DB switch off, change the manifest's `enabled` to `true`, and redeploy
   `jokers-prod-multichain-worker`. Confirm startup verifies the owner/network and
   that Profile operation/submission counts stay zero.
5. After those checks, enable only this mirror:

   ```sql
   update chain.profile_mirrors set enabled=true
   where executor_id='b1cd4451-02e4-461b-bfbb-02405bb48220' and not enabled;
   ```

6. Observe the initial V2 backfill and first receipts. Admissions increment
   `gamesPlayed`; a completed-run fact increments `gamesWon`; terminal games mirror
   game/round data and the remaining per-game stats. Progression is monotonic on
   the existing contract, preserving legacy maxima. V2 history is added to legacy
   totals, so confirm that these games were not already mirrored by another writer.

## Pause and verification

Set the scoped DB switch to `false` first to stop new broadcasts/retries, then
redeploy with the checked-in `enabled:false` manifest. Allow a send already in
flight to settle. Do not delete signed payloads or release their nonce reservations.
Resolve any pending submissions before restarting a different writer on the signer.

```sql
select api.profile_mirror_target('b1cd4451-02e4-461b-bfbb-02405bb48220');
select kind,status,count(*) from chain.operations
where source_kind='profile-mirror' group by kind,status;
select s.status,p.finalized,count(*) from chain.profile_submission_payloads p
join chain.submissions s using(submission_id) group by s.status,p.finalized;
```

## Local validation

`bun test tests/v2 tests/celoAttributionQueue.test.ts`, `bunx tsc --noEmit`,
and `bun run build` cover the worker and configuration. Run
`bun tests/integration/profileMirror.ts` with Docker Supabase
`supabase_db_jokers-of-neon-v2`, Anvil/Forge, and sibling API/Profile repositories.
It creates and removes its own database, deploys the real Profile on local Anvil,
and exercises both off switches, crash recovery, additive idempotency, shared NFT
nonce exclusion, finality and reorg quarantine. It never sends to Celo.
