import { getAddress, isAddress } from 'viem';
import { supabase } from '../config/supabase.js';

interface UserBurnerRecord {
  blockchain: 'starknet' | 'celo';
  user_wallet: string;
  burner_address: string;
}

export async function resolveCeloWalletFromBurnerAddress(burnerAddress: string): Promise<string | null> {
  const normalizedBurnerAddress = burnerAddress.trim().toLowerCase();

  const { data, error } = await supabase
    .from('user_burners')
    .select('blockchain, user_wallet, burner_address')
    .eq('blockchain', 'celo')
    .eq('burner_address', normalizedBurnerAddress)
    .maybeSingle<UserBurnerRecord>();

  if (error) {
    throw new Error(`Failed to resolve Celo wallet from burner address: ${error.message}`);
  }

  if (!data?.user_wallet || !isAddress(data.user_wallet)) {
    return null;
  }

  return getAddress(data.user_wallet);
}
