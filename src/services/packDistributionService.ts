import { env } from '../env.js';
import { supabase } from '../config/supabase.js';
import { getTransactionQueue } from '../transactionQueue.js';
import { getLeaderboardService } from './leaderboardService.js';
import { getRewardsConfig, getRewardsForPosition } from '../config/rewardsConfig.js';
import { PeriodType, LeaderboardEntry } from '../types/leaderboard.js';

interface PeriodRecord {
  id: string;
  period_type: PeriodType;
  period_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_players: number;
  total_packs_distributed: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
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
        .select('id, status')
        .eq('period_type', type)
        .eq('period_id', periodId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found
        throw error;
      }

      // Period is processed if it exists and is completed
      return data?.status === 'completed';
    } catch (error) {
      console.error('❌ Error checking period status:', error);
      return false;
    }
  }

  /**
   * Create or get existing period record
   */
  private async getOrCreatePeriodRecord(type: PeriodType, periodId: string): Promise<PeriodRecord | null> {
    try {
      // Try to get existing record
      const { data: existing, error: fetchError } = await supabase
        .from('leaderboard_reward_periods')
        .select('*')
        .eq('period_type', type)
        .eq('period_id', periodId)
        .single();

      if (existing) {
        return existing;
      }

      // Create new record
      const { data: created, error: insertError } = await supabase
        .from('leaderboard_reward_periods')
        .insert({
          period_type: type,
          period_id: periodId,
          status: 'pending',
          total_players: 0,
          total_packs_distributed: 0,
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      return created;
    } catch (error) {
      console.error('❌ Error creating period record:', error);
      return null;
    }
  }

  /**
   * Update period record status
   */
  private async updatePeriodStatus(
    id: string,
    status: 'processing' | 'completed' | 'failed',
    extra?: { totalPlayers?: number; totalPacksDistributed?: number; errorMessage?: string }
  ): Promise<void> {
    try {
      const updateData: Record<string, any> = { status };

      if (status === 'processing') {
        updateData.started_at = new Date().toISOString();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString();
      }

      if (extra?.totalPlayers !== undefined) {
        updateData.total_players = extra.totalPlayers;
      }

      if (extra?.totalPacksDistributed !== undefined) {
        updateData.total_packs_distributed = extra.totalPacksDistributed;
      }

      if (extra?.errorMessage) {
        updateData.error_message = extra.errorMessage;
      }

      const { error } = await supabase
        .from('leaderboard_reward_periods')
        .update(updateData)
        .eq('id', id);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error('❌ Error updating period status:', error);
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

    // Create or get period record
    const periodRecord = await this.getOrCreatePeriodRecord(periodType, periodKey);
    if (!periodRecord) {
      console.error('❌ Failed to create period record');
      return false;
    }

    // Mark as processing
    await this.updatePeriodStatus(periodRecord.id, 'processing');

    try {
      // Fetch leaderboard
      console.log(`📊 Fetching top ${config.maxPosition} players...`);
      const players = await this.leaderboardService.fetchTopPlayers(config.maxPosition);

      if (players.length === 0) {
        console.warn('⚠️  No players found in leaderboard');
        await this.updatePeriodStatus(periodRecord.id, 'completed', {
          totalPlayers: 0,
          totalPacksDistributed: 0,
        });
        return true;
      }

      console.log(`📊 Found ${players.length} players in leaderboard`);

      let totalPacksDistributed = 0;
      let playersRewarded = 0;

      // Distribute rewards to each eligible player
      for (const player of players) {
        if (!player.position) continue;

        const rewards = getRewardsForPosition(periodType, player.position);
        if (rewards.length === 0) continue;

        console.log(`\n👤 Player #${player.position}: ${player.player_name}`);
        console.log(`   Level: ${player.level}, Score: ${player.player_score}`);

        for (const reward of rewards) {
          // Distribute each pack in the reward
          for (let i = 0; i < reward.quantity; i++) {
            const txId = await this.distributePackToPlayer(player, reward.packId);

            if (txId) {
              totalPacksDistributed++;
            }
          }
        }

        playersRewarded++;
      }

      // Mark as completed
      await this.updatePeriodStatus(periodRecord.id, 'completed', {
        totalPlayers: playersRewarded,
        totalPacksDistributed,
      });

      console.log(`\n✅ Distribution completed!`);
      console.log(`   Players rewarded: ${playersRewarded}`);
      console.log(`   Total packs distributed: ${totalPacksDistributed}`);

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Distribution failed:`, errorMessage);

      await this.updatePeriodStatus(periodRecord.id, 'failed', { errorMessage });
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
