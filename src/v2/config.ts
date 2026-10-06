import { readFile } from 'node:fs/promises';
import type { WorkerConfig } from './terminalWorker.js';

export async function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): Promise<WorkerConfig> {
  const path = env.JOKERS_V2_WORKER_CONFIG;
  const json = env.JOKERS_V2_WORKER_CONFIG_JSON;
  if (Boolean(path) === Boolean(json)) throw new Error('ONE_V2_WORKER_CONFIG_SOURCE_REQUIRED');
  try {
    return JSON.parse(json ?? await readFile(path!, 'utf8')) as WorkerConfig;
  } catch {
    throw new Error('INVALID_V2_WORKER_CONFIG_JSON');
  }
}
