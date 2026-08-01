import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve(__dirname, '../../background.js'), 'utf8');
const budgetKey = 'reknownEnrichmentRequestBudget';

function harness(stored: Record<string, unknown> = {}, initialNow = Date.UTC(2026, 7, 1, 12)) {
  let now = initialNow;
  const writes: Record<string, unknown>[] = [];
  const context: Record<string, any> = {
    console, URL, Date, Math,
    navigator: { userAgent: 'throttle-risk-budget-test' },
    setTimeout: (callback: () => void) => { callback(); return 1; },
    clearTimeout: () => undefined,
    chrome: {
      runtime: {
        id: 'test-extension', getManifest: () => ({ version: 'test' }), lastError: null,
        onConnect: { addListener: () => undefined }, onMessage: { addListener: () => undefined },
      },
      storage: { local: {
        get: (_keys: unknown, callback: (value: object) => void) => callback({ ...stored }),
        set: (payload: Record<string, unknown>, callback: () => void) => {
          writes.push(structuredClone(payload)); Object.assign(stored, payload); callback();
        },
      } },
      tabs: { sendMessage: () => undefined },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\nglobalThis.__api = {
    createBatchRiskState, increaseBatchRisk, recoverBatchRisk, getBatchBackoffMs,
    getThrottleProfileConfig, setThrottleRuntimeDependencies, ensureThrottleConfigReady,
    getRequestBudgetMeta, reserveRequestBudget
  };`, context);
  const api = context.__api;
  api.setThrottleRuntimeDependencies({ now: () => now, random: () => 0.5 });
  return { api, stored, writes, setNow: (value: number) => { now = value; } };
}

describe('batch risk backoff and request budgets', () => {
  it('grows exponentially, remains within jitter bounds, and recovers one level at a time', () => {
    const { api } = harness();
    const batch = { riskState: api.createBatchRiskState() };
    expect(batch.riskState).toMatchObject({ level: 2, lastReason: 'assumed_account_watch' });
    expect(api.getBatchBackoffMs(batch, 0.5)).toBe(60_000);
    api.increaseBatchRisk(batch, 'network');
    expect(api.getBatchBackoffMs(batch, 0)).toBe(90_000);
    expect(api.getBatchBackoffMs(batch, 1)).toBe(150_000);
    api.increaseBatchRisk(batch, 'http_500');
    expect(api.getBatchBackoffMs(batch, 0.5)).toBe(240_000);
    expect(api.recoverBatchRisk(batch)).toBe(3);
    expect(api.recoverBatchRisk(batch)).toBe(2);
  });

  it('applies non-overridable safety floors to the legacy normal profile', () => {
    const { api } = harness();
    const normal = api.getThrottleProfileConfig('normal');
    expect(normal.perRequestMinMs).toBe(60_000);
    expect(normal.perRequestMaxMs).toBe(70_000);
    expect(normal.batchSize).toBe(3);
    expect(normal.batchPauseMs).toBe(300_000);
  });

  it('persists and enforces session limits until the session window expires', async () => {
    const start = Date.UTC(2026, 7, 1, 12);
    const first = harness({}, start);
    await first.api.ensureThrottleConfigReady();
    await first.api.reserveRequestBudget(40, start);
    expect(first.api.getRequestBudgetMeta(1, start).allowed).toBe(false);
    expect(first.writes.some((write) => write[budgetKey])).toBe(true);

    const restarted = harness(first.stored, start + 1000);
    await restarted.api.ensureThrottleConfigReady();
    const blocked = restarted.api.getRequestBudgetMeta(1, start + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.cooldownUntil).toBe(start + 6 * 60 * 60 * 1000);
    restarted.setNow(start + 6 * 60 * 60 * 1000);
    expect(restarted.api.getRequestBudgetMeta(1).allowed).toBe(true);
  });

  it('persists the daily limit across sessions and resets at UTC midnight', async () => {
    const start = Date.UTC(2026, 7, 1, 20);
    const stored = {
      [budgetKey]: { sessionStartedAt: start - 7 * 60 * 60 * 1000, sessionCount: 40,
        dayStartedAt: Date.UTC(2026, 7, 1), dayCount: 100 },
    };
    const run = harness(stored, start);
    await run.api.ensureThrottleConfigReady();
    const blocked = run.api.getRequestBudgetMeta(1, start);
    expect(blocked.allowed).toBe(false);
    expect(blocked.cooldownUntil).toBe(Date.UTC(2026, 7, 2));
    expect(run.api.getRequestBudgetMeta(1, Date.UTC(2026, 7, 2)).allowed).toBe(true);
  });
});
