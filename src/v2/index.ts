import { V2TerminalWorker } from './terminalWorker.js';
import { readWorkerConfig } from './config.js';

const config = await readWorkerConfig();
const worker = new V2TerminalWorker(config);
await worker.ready();
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
console.info('V2 gameplay worker ready', { runtimeId: config.runtimeId });
while (running) {
  try {
    const result = await worker.pollOnce();
    if (result.archived || result.applied) console.info('V2 gameplay events', result);
    if (result.hasMore) continue;
  } catch (error) {
    console.error('V2 ingestion paused; checkpoint preserved:', error instanceof Error ? error.message : 'unknown error');
  }
  if (running) await new Promise(resolve => setTimeout(resolve, 2000));
}
