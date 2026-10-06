import { test, expect } from 'bun:test';
import { readWorkerConfig } from '../../src/v2/config.js';

test('worker requires one explicit configuration source and redacts invalid secret JSON', async () => {
  await expect(readWorkerConfig({})).rejects.toThrow('ONE_V2_WORKER_CONFIG_SOURCE_REQUIRED');
  await expect(readWorkerConfig({JOKERS_V2_WORKER_CONFIG:'unused',JOKERS_V2_WORKER_CONFIG_JSON:'{}'})).rejects.toThrow('ONE_V2_WORKER_CONFIG_SOURCE_REQUIRED');
  await expect(readWorkerConfig({JOKERS_V2_WORKER_CONFIG_JSON:'secret-value-broken'})).rejects.toThrow('INVALID_V2_WORKER_CONFIG_JSON');
  expect(await readWorkerConfig({JOKERS_V2_WORKER_CONFIG_JSON:'{"runtimeId":"runtime"}'})).toEqual({runtimeId:'runtime'});
});
