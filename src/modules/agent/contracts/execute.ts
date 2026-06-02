import type { Account, Call } from 'starknet';
import { withStarknetWriteLock } from '../../../runtime/StarknetWriteCoordinator.js';

export async function executeAgentCall(account: Account, call: Call): Promise<string> {
  return withStarknetWriteLock(account.address, async () => {
    const { transaction_hash } = await account.execute(call);
    return transaction_hash;
  });
}
