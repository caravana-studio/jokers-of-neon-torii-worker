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

function compactValue(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

async function runAgentCycle(): Promise<void> {
  const burners = getBurnerAccounts();
  if (burners.length === 0) {
    console.error('[agent] No burner accounts in BURNER_ACCOUNTS');
    return;
  }

  console.log(`[agent] cycle_start burners=${burners.length} gamesPerAccount=${GAMES_PER_ACCOUNT}`);
  const provider = getProvider();
  const seasonId = getCurrentSeasonIdValue();

  for (let accountIndex = 0; accountIndex < burners.length; accountIndex++) {
    const burner = burners[accountIndex];
    const account = createAccountFromBurner(burner, provider);

    console.log(`[agent] account index=${accountIndex + 1}/${burners.length} address=${compactValue(burner.address)}`);

    try {
      const claimTxHash = await claim(seasonId, account);
      await provider.waitForTransaction(claimTxHash);
      console.log(`[agent] lives_claimed season=${seasonId} hash=${compactValue(claimTxHash)}`);
    } catch (error) {
      console.log(`[agent] lives_claim_skipped reason=${error instanceof Error ? error.message : error}`);
    }

    for (let gameNum = 0; gameNum < GAMES_PER_ACCOUNT; gameNum++) {
      try {
        const { gameId } = await newGame(
          account.address,
          `Chichilo${accountIndex + 1}`,
          null,
          [[], [], [], []],
          false,
          account
        );
        const results = await runAgent(gameId, MAX_STEPS_PER_GAME, account);
        console.log(`[agent] game_done account=${accountIndex + 1}/${burners.length} game=${gameId} steps=${results.length}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes("don't have any lives") || errorMsg.includes('LivesSystem')) {
          console.log(`[agent] account_done reason=no_lives account=${accountIndex + 1}/${burners.length}`);
          break;
        }
        if (errorMsg.includes('execution_error') || errorMsg.includes('Transaction execution')) {
          console.log(`[agent] account_done reason=tx_failed account=${accountIndex + 1}/${burners.length} error=${errorMsg}`);
          break;
        }
        console.error(`[agent] Error: ${errorMsg}`);
      }
    }
  }

  console.log(`[agent] cycle_done nextHours=${env.INTERVAL_HOURS}`);
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
