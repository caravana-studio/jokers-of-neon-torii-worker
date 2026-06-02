import type { Account, Call, UniversalDetails } from 'starknet';
import { withStarknetWriteLock } from '../../../runtime/StarknetWriteCoordinator.js';

function withAgentNoFeeExecuteOptions(options: UniversalDetails = {}): UniversalDetails {
  return {
    ...options,
    tip: 0n,
  };
}

export async function executeAgentCall(account: Account, call: Call): Promise<string> {
  return withStarknetWriteLock(account.address, async () => {
    const nonce = await account.getNonce();
    const { transaction_hash } = await account.execute(
      call,
      withAgentNoFeeExecuteOptions({
        nonce,
        skipValidate: true,
      })
    );
    return transaction_hash;
  });
}
