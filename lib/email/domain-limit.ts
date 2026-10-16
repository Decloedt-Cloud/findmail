const tails = new Map<string, Promise<unknown>>();
const lastRun = new Map<string, number>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function scheduleDomain<T>(host: string, intervalMs: number, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(host) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const elapsed = Date.now() - (lastRun.get(host) ?? 0);
    if (lastRun.has(host) && elapsed < intervalMs) await delay(intervalMs - elapsed);
    try {
      return await task();
    } finally {
      lastRun.set(host, Date.now());
    }
  });
  tails.set(
    host,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export function resetDomainSchedule() {
  tails.clear();
  lastRun.clear();
}
