import { describe, expect, it } from 'vitest';
import { needsProfileEnrichment } from './profile-enrichment';

describe('needsProfileEnrichment', () => {
  it('includes profiles missing a photo or company-history result', () => {
    expect(needsProfileEnrichment({ companies: ['Acme'] })).toBe(true);
    expect(needsProfileEnrichment({ photoDataUrl: 'data:image/png;base64,x' })).toBe(true);
  });

  it('includes previously photo-enriched profiles whose companies were never filled', () => {
    expect(
      needsProfileEnrichment({ photoDataUrl: 'data:image/png;base64,x', companies: undefined }),
    ).toBe(true);
  });

  it('treats an empty company-history result as complete', () => {
    expect(
      needsProfileEnrichment({ photoDataUrl: 'data:image/png;base64,x', companies: [] }),
    ).toBe(false);
  });
});
