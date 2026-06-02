import { registerBlockchainAdapter } from './registry.js';
import { slotAdapter } from './slotAdapter.js';
import { celoAdapter } from './celoAdapter.js';
import { starknetAdapter } from './starknetAdapter.js';

registerBlockchainAdapter(slotAdapter);
registerBlockchainAdapter(starknetAdapter);
registerBlockchainAdapter(celoAdapter);

export {
  executeIntent,
  getBlockchainAdapter,
  getRegisteredBlockchains,
  isRegisteredBlockchain,
  registerBlockchainAdapter,
} from './registry.js';
export type { BlockchainAdapter } from './types.js';
