import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const backgroundPath = path.resolve(__dirname, '../../background.js');

function loadDetector(): (html: string) => boolean {
  const source = fs.readFileSync(backgroundPath, 'utf8');
  const context: Record<string, unknown> = {
    console,
    navigator: { userAgent: 'vitest' },
    chrome: {
      runtime: {
        id: 'test-extension',
        getManifest: () => ({ version: 'test' }),
        onConnect: { addListener: () => undefined },
        onMessage: { addListener: () => undefined },
        lastError: null,
      },
      storage: { local: { get: (_: unknown, cb: (v: object) => void) => cb({}), set: (_: unknown, cb: () => void) => cb() } },
      tabs: { sendMessage: () => undefined },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\nglobalThis.__detector = isAccountActivityWarning;`, context);
  return context.__detector as (html: string) => boolean;
}

describe('LinkedIn account activity warning detection', () => {
  it('recognizes the high-volume access warning despite HTML markup', () => {
    const detect = loadDetector();
    expect(detect(`
      <h1>activity on your account</h1>
      <p>Our systems have shown your account has accessed a <b>high volume</b>
      of LinkedIn profile data.</p>
      <p>Please review your browser extensions and any third-party apps connected to your account.</p>
    `)).toBe(true);
  });

  it('does not confuse an ordinary extension-help page for the warning', () => {
    const detect = loadDetector();
    expect(detect('<p>Review your browser extensions before using a third-party tool.</p>')).toBe(false);
  });
});
