import { toDataSuffix } from '@celo/attribution-tags';
import { concat, type Hex } from 'viem';

export const CELO_ATTRIBUTION_CODE = 'celo_zni2b7n2';
const suffix = toDataSuffix(CELO_ATTRIBUTION_CODE);

/** Append before simulation, gas estimation and signing; other EVM networks stay unchanged. */
export function tagCeloCalldata(data: Hex, chainId: string | number): Hex {
  const network = BigInt(chainId);
  return network === 42220n || network === 11142220n
    ? concat([data, suffix])
    : data;
}
