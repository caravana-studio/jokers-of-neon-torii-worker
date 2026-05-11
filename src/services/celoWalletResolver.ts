import { getAddress, isAddress } from 'viem';
import { supabase } from '../config/supabase.js';

interface UserBurnerRecord {
  blockchain: 'starknet' | 'celo';
  user_wallet: string;
  burner_address: string;
}

function normalizeBurnerAddress(burnerAddress: string): string {
  const normalized = burnerAddress.trim().toLowerCase();

  if (!normalized.startsWith('0x')) {
    return normalized;
  }

  const hexBody = normalized.slice(2).replace(/^0+/, '') || '0';
  return `0x${hexBody}`;
}

function areEquivalentBurnerAddresses(left: string, right: string): boolean {
  try {
    return BigInt(normalizeBurnerAddress(left)) === BigInt(normalizeBurnerAddress(right));
  } catch {
    return normalizeBurnerAddress(left) === normalizeBurnerAddress(right);
  }
}

export async function resolveCeloWalletFromBurnerAddress(burnerAddress: string): Promise<string | null> {
  const normalizedBurnerAddress = burnerAddress.trim().toLowerCase();
  const canonicalBurnerAddress = normalizeBurnerAddress(burnerAddress);

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
    const burnerHexBody = canonicalBurnerAddress.startsWith('0x')
      ? canonicalBurnerAddress.slice(2)
      : canonicalBurnerAddress;

    const { data: fallbackData, error: fallbackError } = await supabase
      .from('user_burners')
      .select('blockchain, user_wallet, burner_address')
      .eq('blockchain', 'celo')
      .ilike('burner_address', `0x%${burnerHexBody}`);

    if (fallbackError) {
      throw new Error(`Failed to resolve Celo wallet from burner address fallback: ${fallbackError.message}`);
    }

    const matchingRecord = fallbackData?.find(record =>
      areEquivalentBurnerAddresses(record.burner_address, burnerAddress)
    );

    if (!matchingRecord?.user_wallet || !isAddress(matchingRecord.user_wallet)) {
      return null;
    }

    return getAddress(matchingRecord.user_wallet);
  }

  return getAddress(data.user_wallet);
}
