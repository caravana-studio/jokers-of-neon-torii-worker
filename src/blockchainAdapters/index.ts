import { registerBlockchainAdapter } from './registry.js';
import { celoAdapter } from './celoAdapter.js';
import { starknetAdapter } from './starknetAdapter.js';

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
