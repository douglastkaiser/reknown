import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve(__dirname, '../../background.js'), 'utf8');

function harness(initialNow = 1_800_000_000_000) {
  let now = initialNow;
  const stored: Record<string, any> = {};
  const FakeDate = class extends Date {
    constructor(value?: string | number) { super(value === undefined ? now : value); }
    static now() { return now; }
  } as DateConstructor;
  const context: Record<string, any> = {
    console, URL, Date: FakeDate, setTimeout, clearTimeout,
    navigator: { userAgent: 'retry-after-test' },
    chrome: {
      runtime: {
        id: 'test', getManifest: () => ({ version: 'test' }), lastError: null,
        onConnect: { addListener: () => undefined }, onMessage: { addListener: () => undefined },
      },
      storage: { local: {
        get: (_keys: unknown, cb: (value: object) => void) => cb({ ...stored }),
        set: (value: object, cb: () => void) => { Object.assign(stored, value); cb(); },
      } },
      tabs: { sendMessage: () => undefined },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\nglobalThis.__api = {
    parseRetryAfterDeadline, setRateLimitCooldown,
    setConfig(fn) { getActiveThrottleConfig = fn; },
    getState: () => ({ rateLimitCooldownUntil, throttleStrike })
  };`, context);
  context.__api.setConfig(() => ({ profile: 'test', rateLimitCooldownMs: 60_000 }));
  return { api: context.__api, stored, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('Retry-After cooldown calculation', () => {
  it('parses delta-seconds and HTTP-date values as deadlines', () => {
    const h = harness();
    expect(h.api.parseRetryAfterDeadline('120', h.now())).toBe(h.now() + 120_000);
    const date = new Date(h.now() + 180_000).toUTCString();
    expect(h.api.parseRetryAfterDeadline(date, h.now())).toBe(h.now() + 180_000);
  });

  it('rejects malformed input and clamps unreasonable values', () => {
    const h = harness();
    expect(h.api.parseRetryAfterDeadline('not a date', h.now())).toBeNull();
    expect(h.api.parseRetryAfterDeadline('-10', h.now())).toBeNull();
    expect(h.api.parseRetryAfterDeadline('999999999999', h.now()))
      .toBe(h.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it('keeps the longest overlapping cooldown', async () => {
    const h = harness();
    const longDeadline = h.now() + 300_000;
    await h.api.setRateLimitCooldown(h.now(), { retryAfterDeadline: longDeadline });
    h.advance(1_000);
    const result = await h.api.setRateLimitCooldown(h.now(), { retryAfterDeadline: h.now() + 10_000 });
    expect(result.cooldownUntil).toBe(longDeadline);
    expect(result.cooldownRemainingMs).toBe(299_000);
  });

  it('escalates safety cooldown for consecutive throttle strikes', async () => {
    const h = harness();
    const first = await h.api.setRateLimitCooldown(h.now(), {});
    h.advance(1_000);
    const second = await h.api.setRateLimitCooldown(h.now(), {});
    h.advance(1_000);
    const third = await h.api.setRateLimitCooldown(h.now(), {});
    expect(first.safetyCooldownMs).toBe(60_000);
    expect(second).toMatchObject({ consecutiveThrottleStrikes: 2, safetyCooldownMs: 120_000 });
    expect(third).toMatchObject({ consecutiveThrottleStrikes: 3, safetyCooldownMs: 240_000 });
    expect(h.stored.reknownThrottleStrike).toEqual({
      lastThrottleAt: h.now(), consecutiveStrikes: 3,
    });
  });
});
