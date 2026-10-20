import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export function configuredServices(env: NodeJS.ProcessEnv): string[] {
  const files = ["index", "packIndex"];
  if (env.JOKERS_V2_COMMERCE_CONFIG || env.JOKERS_V2_COMMERCE_CONFIG_JSON) files.push("commerceIndex");
  if (env.JOKERS_V2_SETTLEMENT_CONFIG || env.JOKERS_V2_SETTLEMENT_CONFIG_JSON) files.push("settlement/index");
  return files;
}

/** Each child restarts independently; shutdown also cancels pending restarts. */
export function superviseServices(entries: URL[], options: { restartDelayMs?: number; shutdownTimeoutMs?: number } = {}) {
  const children = new Set<ChildProcess>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  let stopping = false;
  let resolveStopped: (() => void) | undefined;
  let stopped: Promise<void> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function start(entry: URL) {
    if (stopping) return;
    const child = spawn(process.execPath, [fileURLToPath(entry)], { stdio: "inherit", env: process.env });
    children.add(child);
    child.on("error", () => console.error("V2 child could not start", { service: entry.pathname }));
    child.on("close", () => {
      children.delete(child);
      if (!stopping) {
        const retry = setTimeout(() => { retries.delete(retry); start(entry); }, options.restartDelayMs ?? 5000);
        retries.add(retry);
      } else if (!children.size) {
        clearTimeout(deadline);
        resolveStopped?.();
      }
    });
  }
  entries.forEach(start);
  return {
    stop(): Promise<void> {
      if (stopped) return stopped;
      stopping = true;
      for (const retry of retries) clearTimeout(retry);
      retries.clear();
      stopped = new Promise<void>(resolve => { resolveStopped = resolve; });
      if (!children.size) resolveStopped!();
      else {
        for (const child of children) child.kill("SIGTERM");
        deadline = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, options.shutdownTimeoutMs ?? 20000);
        deadline.unref();
      }
      return stopped;
    },
  };
}
