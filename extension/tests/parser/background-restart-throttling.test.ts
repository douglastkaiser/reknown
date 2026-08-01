import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const backgroundPath = path.resolve(__dirname, '../../background.js');
const source = fs.readFileSync(backgroundPath, 'utf8');
const cooldownKey = 'reknownRateLimitCooldownUntil';
const requestKey = 'reknownLastLinkedInRequestAt';

function loadBackground(stored: Record<string, unknown>, initialNow = 1_800_000_000_000) {
  let now = initialNow;
  let sleptMs = 0;
  const writes: Record<string, unknown>[] = [];
  const FakeDate = class extends Date {
    constructor(value?: string | number) { super(value === undefined ? now : value); }
    static now() { return now; }
  } as DateConstructor;
  const deterministicMath = Object.create(Math) as Math;
  deterministicMath.random = () => 0;
  const listener = { current: null as null | ((...args: any[]) => unknown) };
  const context: Record<string, unknown> = {
    console, URL, Date: FakeDate, Math: deterministicMath,
    navigator: { userAgent: 'restart-throttling-test' },
    setTimeout: (callback: () => void, ms: number) => { sleptMs += ms; now += ms; callback(); return 1; },
    clearTimeout: () => undefined,
    chrome: {
      runtime: {
        id: 'test-extension', getManifest: () => ({ version: 'test' }), lastError: null,
        onConnect: { addListener: () => undefined },
        onMessage: { addListener: (fn: (...args: any[]) => unknown) => { listener.current = fn; } },
      },
      storage: { local: {
        get: (_keys: unknown, callback: (value: object) => void) => callback({ ...stored }),
        set: (payload: Record<string, unknown>, callback: () => void) => {
          writes.push(payload); Object.assign(stored, payload); callback();
        },
      } },
      tabs: { sendMessage: () => undefined },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\nglobalThis.__restart = {
    ensureThrottleConfigReady, getRateLimitCooldownMeta, waitForLinkedInRequestSlot,
    getState: () => ({ rateLimitCooldownUntil, lastLinkedInRequestAt })
  };`, context);
  return {
    api: context.__restart as any, writes,
    get sleptMs() { return sleptMs; },
  };
}

describe('background throttle protection across restarts', () => {
  it('keeps an active stored cooldown enforced', async () => {
    const now = 1_800_000_000_000;
    const harness = loadBackground({ [cooldownKey]: now + 30_000 }, now);
    await harness.api.ensureThrottleConfigReady();
    expect(harness.api.getRateLimitCooldownMeta(now).cooldownRemainingMs).toBe(30_000);
  });

  it('preserves LinkedIn request spacing after restart', async () => {
    const now = 1_800_000_000_000;
    const harness = loadBackground({ [requestKey]: now - 10_000 }, now);
    await harness.api.ensureThrottleConfigReady();
    await harness.api.waitForLinkedInRequestSlot('https://media.licdn.com/photo.jpg', { cancelled: false });
    expect(harness.sleptMs).toBe(50_000);
    expect(harness.writes.some((write) => Number(write[requestKey]) >= now)).toBe(true);
  });

  it('discards expired persisted values', async () => {
    const now = 1_800_000_000_000;
    const harness = loadBackground({ [cooldownKey]: now - 1, [requestKey]: now - 100_000 }, now);
    await harness.api.ensureThrottleConfigReady();
    expect(harness.api.getState()).toEqual({ rateLimitCooldownUntil: 0, lastLinkedInRequestAt: 0 });
    expect(harness.writes).toContainEqual({ [cooldownKey]: 0 });
    expect(harness.writes).toContainEqual({ [requestKey]: 0 });
  });

  it('discards malformed values and bounds implausibly future values without disabling protection', async () => {
    const now = 1_800_000_000_000;
    const malformed = loadBackground({ [cooldownKey]: 'tomorrow', [requestKey]: Number.NaN }, now);
    await malformed.api.ensureThrottleConfigReady();
    expect(malformed.api.getState()).toEqual({ rateLimitCooldownUntil: 0, lastLinkedInRequestAt: 0 });
    expect(malformed.writes).toContainEqual({ [cooldownKey]: 0 });
    expect(malformed.writes).toContainEqual({ [requestKey]: 0 });

    const harness = loadBackground({ [cooldownKey]: now + 99_999_999_999, [requestKey]: now + 99_999_999_999 }, now);
    await harness.api.ensureThrottleConfigReady();
    expect(harness.api.getRateLimitCooldownMeta(now).cooldownRemainingMs).toBe(2 * 60 * 60 * 1000);
    await harness.api.waitForLinkedInRequestSlot('https://www.linkedin.com/in/test', { cancelled: false });
    expect(harness.sleptMs).toBe(60_000);
  });
});
