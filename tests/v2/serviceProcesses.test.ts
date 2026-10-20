import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { configuredServices, superviseServices } from "../../src/v2/serviceProcesses.js";

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function lines(path: string) { try { return (await readFile(path, "utf8")).trim().split("\n"); } catch { return []; } }
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await pause(20); }
  throw new Error("CHILD_PROCESS_TEST_TIMEOUT");
}
test("one worker runs gameplay, payments and NFT; NFT restart does not restart the other services", async () => {
  expect(configuredServices({})).toEqual(["index", "packIndex"]);
  const services = configuredServices({ JOKERS_V2_COMMERCE_CONFIG_JSON: "{}", JOKERS_V2_SETTLEMENT_CONFIG_JSON: "{}" });
  const directory = await mkdtemp(join(tmpdir(), "v2-services-"));
  await mkdir(join(directory, "settlement"));
  for (const name of services) {
    const log = join(directory, name.replaceAll("/", "-") + ".log");
    await writeFile(join(directory, name + ".mjs"), `
      import {appendFileSync,existsSync} from 'node:fs';
      const log=${JSON.stringify(log)}, first=!existsSync(log);
      process.on('SIGTERM',()=>{appendFileSync(log,'stopped\\n');process.exit(0)});
      appendFileSync(log,process.pid+'\\n');
      if(${JSON.stringify(name)}==='settlement/index' && first) process.exit(1);
      setInterval(()=>{},1000);
    `);
  }
  const supervisor = superviseServices(services.map(name => pathToFileURL(join(directory, name + ".mjs"))), { restartDelayMs: 25, shutdownTimeoutMs: 200 });
  try {
    await until(async () => (await lines(join(directory, "settlement-index.log"))).length === 2);
    expect((await lines(join(directory, "index.log"))).length).toBe(1);
    expect((await lines(join(directory, "commerceIndex.log"))).length).toBe(1);
    await supervisor.stop();
    await supervisor.stop();
    for (const name of services) expect((await lines(join(directory, name.replaceAll("/", "-") + ".log"))).at(-1)).toBe("stopped");
    await pause(80);
    expect((await lines(join(directory, "settlement-index.log"))).length).toBe(3);
  } finally { await supervisor.stop(); await rm(directory, { recursive: true, force: true }); }
});
test("shutdown terminates children that ignore SIGTERM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "v2-services-stop-"));
  const log = join(directory, "started");
  await writeFile(join(directory, "stuck.mjs"), `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(log)},String(process.pid));setInterval(()=>{},1000);`);
  const supervisor = superviseServices([pathToFileURL(join(directory, "stuck.mjs"))], { restartDelayMs: 25, shutdownTimeoutMs: 50 });
  try {
    await until(async () => (await lines(log)).length === 1);
    const pid = Number((await lines(log))[0]);
    await supervisor.stop();
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { await supervisor.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("shutdown cancels an NFT restart already waiting in backoff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "v2-services-backoff-"));
  const log = join(directory, "starts");
  await writeFile(join(directory, "crash.mjs"), `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(log)},'started\\n');process.exit(1);`);
  const supervisor = superviseServices([pathToFileURL(join(directory, "crash.mjs"))], { restartDelayMs: 300 });
  try {
    await until(async () => (await lines(log)).length === 1);
    await pause(50);
    await supervisor.stop();
    await pause(350);
    expect((await lines(log)).length).toBe(1);
  } finally { await supervisor.stop(); await rm(directory, { recursive: true, force: true }); }
});
