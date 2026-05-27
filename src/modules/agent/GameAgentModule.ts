import { env } from '../../env.js';
import { runAgent } from './agent/gameAgent.js';
import { claim } from './contracts/livesSystem.js';
import { newGame } from './contracts/gameSystem.js';
import { getBurnerAccounts, createAccountFromBurner, getProvider } from './agentConfig.js';
import { preloadGameViewsData, getCurrentSeasonIdValue } from './gameViews.js';
import { JobScheduler } from '../../runtime/JobScheduler.js';

const GAMES_PER_ACCOUNT = 2;
const MAX_STEPS_PER_GAME = 200;

let scheduler: JobScheduler | null = null;

async function runAgentCycle(): Promise<void> {
  const burners = getBurnerAccounts();
  if (burners.length === 0) {
    console.error('[agent] No burner accounts in BURNER_ACCOUNTS');
    return;
  }

  console.log(`[agent] ${burners.length} burner(s), ${GAMES_PER_ACCOUNT} games each`);
  const provider = getProvider();
  const seasonId = getCurrentSeasonIdValue();

  for (let accountIndex = 0; accountIndex < burners.length; accountIndex++) {
    const burner = burners[accountIndex];
    const account = createAccountFromBurner(burner, provider);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[agent] Account ${accountIndex + 1}/${burners.length} ${burner.address.slice(0, 10)}...`);

    try {
      const claimTxHash = await claim(seasonId, account);
      console.log(`[agent] Lives claimed season ${seasonId}: ${claimTxHash}`);
    } catch (error) {
      console.log(`[agent] Lives claim skipped: ${error instanceof Error ? error.message : error}`);
    }

    for (let gameNum = 0; gameNum < GAMES_PER_ACCOUNT; gameNum++) {
      console.log(`\n[agent] Game ${gameNum + 1}/${GAMES_PER_ACCOUNT}`);
      try {
        const { gameId } = await newGame(
          account.address,
          `Chichilo${accountIndex + 1}`,
          null,
          [[], [], [], []],
          false,
          account
        );
        console.log(`[agent] Created game ${gameId}`);
        const results = await runAgent(gameId, MAX_STEPS_PER_GAME, account);
        console.log(`[agent] Finished in ${results.length} steps`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("don't have any lives") || errorMsg.includes('LivesSystem')) {
          console.log('[agent] No lives, next account');
          break;
        }
        if (errorMsg.includes('execution_error') || errorMsg.includes('Transaction execution')) {
          console.log('[agent] Tx failed, next account');
          break;
        }
        console.error(`[agent] Error: ${errorMsg}`);
      }
    }
  }

  console.log(`[agent] Cycle done. Next in ${env.INTERVAL_HOURS}h`);
}

export async function startGameAgentModule(): Promise<void> {
  if (!env.GAME_AGENT_ENABLED) {
    return;
  }

  await preloadGameViewsData();

  scheduler = new JobScheduler();
  scheduler.registerIntervalJob({
    name: 'Game Agent',
    intervalMs: env.INTERVAL_HOURS * 60 * 60 * 1000,
    runOnStart: true,
    enabled: true,
    run: runAgentCycle,
  });
}

export async function stopGameAgentModule(): Promise<void> {
  scheduler?.stop();
  scheduler = null;
}
