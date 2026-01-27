import { env } from '../env.js';
import { supabase } from '../config/supabase.js';
import { getTransactionQueue } from '../transactionQueue.js';
import { getLeaderboardService } from './leaderboardService.js';
import { getRewardsConfig, getRewardsForPosition } from '../config/rewardsConfig.js';
import { PeriodType, LeaderboardEntry } from '../types/leaderboard.js';

interface PlayerRewardData {
  position: number;
  player_address: string;
  player_name: string;
  level: number;
  round: number;
  score: number;
  packs: number[]; // Array of pack IDs distributed
}

export class PackDistributionService {
  private txQueue = getTransactionQueue();
  private leaderboardService = getLeaderboardService();

  /**
   * Generate period ID based on type and date
   * Daily: YYYY-MM-DD
   * Weekly: YYYY-WNN (ISO week number)
   */
  getPeriodId(type: PeriodType, date: Date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');

    if (type === 'daily') {
      return `${year}-${month}-${day}`;
    } else {
      // Calculate ISO week number
      const weekNumber = this.getISOWeekNumber(date);
      return `${year}-W${String(weekNumber).padStart(2, '0')}`;
    }
  }

  /**
   * Get the period ID for the PREVIOUS period (yesterday or last week)
   */
  getPreviousPeriodId(type: PeriodType): string {
    const now = new Date();

    if (type === 'daily') {
      // Yesterday
      const yesterday = new Date(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      return this.getPeriodId('daily', yesterday);
    } else {
      // Last week - go back 7 days
      const lastWeek = new Date(now);
      lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
      return this.getPeriodId('weekly', lastWeek);
    }
  }

  /**
   * Get the date range for a period
   * The day boundary is at 6am UTC (3am Argentina time)
   * Returns { startDate, endDate } in YYYY-MM-DD format
   */
  getDateRangeForPeriod(type: PeriodType): { startDate: string; endDate: string } {
    const now = new Date();

    if (type === 'daily') {
      // Yesterday's day: from yesterday to today (6am UTC boundaries)
      const yesterday = new Date(now);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const startDate = this.formatDate(yesterday);
      const endDate = this.formatDate(now);

      return { startDate, endDate };
    } else {
      // Last week: Monday to Monday
      // Find last Monday (the end of the period we're distributing for)
      const lastMonday = new Date(now);
      const daysSinceMonday = (lastMonday.getUTCDay() + 6) % 7; // Days since last Monday
      lastMonday.setUTCDate(lastMonday.getUTCDate() - daysSinceMonday);

      // The Monday before that is the start
      const startMonday = new Date(lastMonday);
      startMonday.setUTCDate(startMonday.getUTCDate() - 7);

      const startDate = this.formatDate(startMonday);
      const endDate = this.formatDate(lastMonday);

      return { startDate, endDate };
    }
  }

  /**
   * Format a date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Calculate ISO week number
   */
  private getISOWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Check if a period has already been processed
   */
  async isPeriodProcessed(type: PeriodType, periodId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('leaderboard_reward_periods')
        .select('id')
        .eq('period_type', type)
        .eq('period_id', periodId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found
        throw error;
      }

      // Period is processed if record exists
      return !!data;
    } catch (error) {
      console.error('❌ Error checking period status:', error);
      return false;
    }
  }

  /**
   * Save the period rewards data
   */
  private async savePeriodRewards(
    type: PeriodType,
    periodId: string,
    rewardsData: PlayerRewardData[]
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('leaderboard_reward_periods')
        .insert({
          period_type: type,
          period_id: periodId,
          rewards_data: rewardsData,
        });

      if (error) {
        throw error;
      }

      console.log(`✅ Period rewards saved to database`);
    } catch (error) {
      console.error('❌ Error saving period rewards:', error);
      throw error;
    }
  }

  /**
   * Distribute a pack to a player via the transaction queue
   */
  private async distributePackToPlayer(
    player: LeaderboardEntry,
    packId: number
  ): Promise<string | null> {
    try {
      console.log(`   📦 Distributing pack ${packId} to ${player.player_name} (${player.owner})`);

      // Enqueue transaction
      const txId = await this.txQueue.enqueue({
        contractAddress: env.PROFILE_SYSTEM_CONTRACT_ADDRESS,
        entrypoint: 'add_claimable_pack',
        calldata: [player.owner, packId.toString()],
      });

      return txId;
    } catch (error) {
      console.error(`❌ Error distributing pack to ${player.owner}:`, error);
      return null;
    }
  }

  /**
   * Main entry point for distributing rewards
   */
  async distributeRewards(periodType: PeriodType): Promise<boolean> {
    console.log(`\n🎁 Starting ${periodType} reward distribution...`);

    // Check if distribution is enabled
    if (!env.PACK_DISTRIBUTION_ENABLED) {
      console.log('ℹ️  Pack distribution is disabled');
      return false;
    }

    // Check if required config is available
    if (!env.PROFILE_SYSTEM_CONTRACT_ADDRESS || !env.STARKNET_PRIVATE_KEY) {
      console.log('ℹ️  Profile System not configured (read-only mode)');
      return false;
    }

    // Get rewards config
    const config = getRewardsConfig(periodType);
    if (!config) {
      console.error(`❌ No rewards config found for ${periodType}`);
      return false;
    }

    // Get the previous period ID (distribute rewards for yesterday/last week)
    const periodKey = this.getPreviousPeriodId(periodType);
    console.log(`📅 Period: ${periodKey}`);

    // Check if already processed
    if (await this.isPeriodProcessed(periodType, periodKey)) {
      console.log(`✅ Period ${periodKey} already processed, skipping`);
      return true;
    }

    try {
      // Get date range for this period
      const { startDate, endDate } = this.getDateRangeForPeriod(periodType);
      console.log(`📅 Date range: ${startDate} to ${endDate}`);

      // Fetch leaderboard
      console.log(`📊 Fetching top ${config.maxPosition} players...`);
      const players = await this.leaderboardService.fetchTopPlayersForDateRange(
        config.maxPosition,
        startDate,
        endDate
      );

      if (players.length === 0) {
        console.warn('⚠️  No players found in leaderboard');
        // Save empty rewards data
        await this.savePeriodRewards(periodType, periodKey, []);
        return true;
      }

      console.log(`📊 Found ${players.length} players in leaderboard`);

      const rewardsData: PlayerRewardData[] = [];

      // Build rewards data for each eligible player
      for (const player of players) {
        if (!player.position) continue;

        const rewards = getRewardsForPosition(periodType, player.position);
        if (rewards.length === 0) continue;

        const playerPacks: number[] = [];

        for (const reward of rewards) {
          for (let i = 0; i < reward.quantity; i++) {
            const txId = await this.distributePackToPlayer(player, reward.packId);

            if (txId) {
              playerPacks.push(reward.packId);
            }
          }
        }

        rewardsData.push({
          position: player.position,
          player_address: player.owner,
          player_name: player.player_name,
          level: player.level,
          round: player.round,
          score: player.player_score,
          packs: playerPacks,
        });
      }

      // Log packs per player
      console.log('\n📦 PACKS POR JUGADOR:');
      console.log('─'.repeat(80));
      for (const data of rewardsData) {
        console.log(`   #${data.position} | ${data.player_name} | Packs: [${data.packs.join(', ')}]`);
      }
      console.log('─'.repeat(80));

      // Log what will be saved to DB
      console.log('\n💾 DATOS A GUARDAR EN BD:');
      console.log('─'.repeat(80));
      console.log(`   period_type: "${periodType}"`);
      console.log(`   period_id: "${periodKey}"`);
      console.log(`   rewards_data: ${JSON.stringify(rewardsData, null, 2)}`);
      console.log('─'.repeat(80));

      // Save the period with all rewards data
      await this.savePeriodRewards(periodType, periodKey, rewardsData);

      const totalPacks = rewardsData.reduce((sum, p) => sum + p.packs.length, 0);
      console.log(`\n✅ Distribution completed (DRY RUN)`);
      console.log(`   Players rewarded: ${rewardsData.length}`);
      console.log(`   Total packs: ${totalPacks}`);

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Distribution failed:`, errorMessage);
      return false;
    }
  }
}

// Singleton instance
let packDistributionServiceInstance: PackDistributionService | null = null;

/**
 * Get or create the singleton pack distribution service instance
 */
export function getPackDistributionService(): PackDistributionService {
  if (!packDistributionServiceInstance) {
    packDistributionServiceInstance = new PackDistributionService();
  }
  return packDistributionServiceInstance;
}
