import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const backgroundPath = path.resolve(__dirname, '../../background.js');

describe('LinkedIn request pacing', () => {
  it('applies bounded safe-profile jitter to consecutive LinkedIn and LICDN requests', async () => {
    const source = fs.readFileSync(backgroundPath, 'utf8');
    let sleptMs = 0;
    const deterministicMath = Object.create(Math) as Math;
    deterministicMath.random = () => 0.5;
    const context: Record<string, unknown> = {
      console,
      URL,
      Date,
      Math: deterministicMath,
      navigator: { userAgent: 'request-pacing-test' },
      setTimeout: (callback: () => void, ms: number) => {
        sleptMs += ms;
        callback();
        return 1;
      },
      clearTimeout: () => undefined,
      chrome: {
        runtime: {
          id: 'test-extension',
          getManifest: () => ({ version: 'test' }),
          onConnect: { addListener: () => undefined },
          onMessage: { addListener: () => undefined },
          lastError: null,
        },
        storage: {
          local: {
            get: (_: unknown, callback: (value: object) => void) => callback({}),
            set: (_: unknown, callback: () => void) => callback(),
          },
        },
        tabs: { sendMessage: () => undefined },
      },
    };
    context.globalThis = context;
    vm.runInNewContext(
      `${source}\nglobalThis.__pacing = { waitForLinkedInRequestSlot, getActiveThrottleConfig };`,
      context,
    );
    const api = context.__pacing as {
      waitForLinkedInRequestSlot: (url: string, batch: { cancelled: boolean }) => Promise<void>;
      getActiveThrottleConfig: () => { perRequestMinMs: number; perRequestJitterMs: number };
    };

    const batch = {
      cancelled: false,
      riskState: { level: 2, consecutiveExtractionFailures: 0, lastReason: 'assumed_account_watch' },
    };
    await api.waitForLinkedInRequestSlot('https://www.linkedin.com/in/example/', batch);
    await api.waitForLinkedInRequestSlot('https://media.licdn.com/example.jpg', batch);

    expect(api.getActiveThrottleConfig().perRequestMinMs).toBe(60_000);
    expect(api.getActiveThrottleConfig().perRequestJitterMs).toBe(15_000);
    // The assumed-watch posture adds a 60-second backoff before the first
    // request. Math.random is fixed at 0.5, so the next gap is 67.5 seconds
    // plus the same 60-second elevated-risk backoff.
    // Allow a little real clock time because only the remainder sleeps.
    expect(sleptMs).toBeGreaterThanOrEqual(186_500);
    expect(sleptMs).toBeLessThanOrEqual(187_500);
  });
});
