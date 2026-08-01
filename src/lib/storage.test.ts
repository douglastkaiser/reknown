import { describe, expect, it, vi } from 'vitest';

vi.mock('idb', () => ({
  openDB: () => new Promise(() => undefined),
}));

import { normalizeSettings } from './storage';

describe('settings normalization', () => {
  it('migrates the legacy facerOptionCount property and removes it', () => {
    const settings = normalizeSettings({ facerOptionCount: 12 }, 'app:guest');

    expect(settings.faceOptionCount).toBe(12);
    expect(settings).not.toHaveProperty('facerOptionCount');
  });

  it('prefers the corrected property when both spellings are persisted', () => {
    const settings = normalizeSettings(
      { faceOptionCount: 10, facerOptionCount: 12 },
      'app:guest',
    );

    expect(settings.faceOptionCount).toBe(10);
    expect(settings).not.toHaveProperty('facerOptionCount');
  });
});
