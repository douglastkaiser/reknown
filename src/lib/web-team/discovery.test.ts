import { describe, expect, it } from 'vitest';
import { prepareWebTeamSectionImports, validateWebTeamProviderUrl } from '.';

describe('validateWebTeamProviderUrl', () => {
  it('accepts valid vast team URLs', () => {
    const result = validateWebTeamProviderUrl('vast', 'https://www.vastspace.com/team?utm=seed');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsedUrl.hostname).toBe('www.vastspace.com');
    }
  });

  it('rejects untrusted discovery URLs outside provider patterns', () => {
    const result = validateWebTeamProviderUrl('vast', 'https://www.vastspace.com/about');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('For Vast');
    }
  });
});

describe('prepareWebTeamSectionImports', () => {
  it('keeps accepted and rejected candidates separate', () => {
    const result = prepareWebTeamSectionImports({
      provider: 'vast',
      candidates: [
        {
          source: 'yc_directory',
          companyName: 'Vast',
          companyUrl: 'https://www.vastspace.com/team',
        },
        {
          source: 'yc_directory',
          companyName: 'Not Valid For Vast Parser',
          companyUrl: 'https://example.com/team',
        },
      ],
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].name).toBe('Vast');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].candidate.companyName).toBe('Not Valid For Vast Parser');
  });
});
