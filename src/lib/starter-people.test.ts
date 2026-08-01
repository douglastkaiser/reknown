import { describe, expect, it } from 'vitest';
import { starterPeople } from './starter-people';

const starterCases = starterPeople.map((starter, index) => ({
  index,
  starter,
  label:
    typeof starter.name === 'string' && starter.name.trim()
      ? starter.name
      : `starterPeople[${index}]`,
}));

describe('starter people', () => {
  it('has at least one seeded person', () => {
    expect(starterPeople.length).toBeGreaterThan(0);
  });

  it.each(starterCases)('$label has a nonblank name', ({ index, starter }) => {
    expect(
      typeof starter.name === 'string' && starter.name.trim().length > 0,
      `starterPeople[${index}] must have a nonblank name`,
    ).toBe(true);
  });

  it.each(starterCases)('$label has a unique normalized name', ({ index, label, starter }) => {
    const normalizedName = typeof starter.name === 'string' ? starter.name.trim().toLowerCase() : '';
    const matchingIndexes = starterPeople.flatMap((candidate, candidateIndex) =>
      typeof candidate.name === 'string' && candidate.name.trim().toLowerCase() === normalizedName
        ? [candidateIndex]
        : [],
    );

    expect(
      matchingIndexes,
      `${label} (starterPeople[${index}]) has a duplicate normalized name at indexes ${matchingIndexes.join(', ')}`,
    ).toEqual([index]);
  });

  it.each(starterCases)('$label has a usable HTTP(S) photo URL', ({ index, label, starter }) => {
    const photoUrl = starter.photoUrl;
    const location = `${label} (starterPeople[${index}])`;

    if (typeof photoUrl !== 'string' || photoUrl.trim().length === 0) {
      expect.fail(`${location} must have a nonblank photoUrl`);
    }

    let parsedPhotoUrl: URL | undefined;
    expect(
      () => {
        parsedPhotoUrl = new URL(photoUrl);
      },
      `${location} must have a structurally valid photoUrl`,
    ).not.toThrow();

    expect(
      parsedPhotoUrl?.protocol,
      `${location} photoUrl must use the http: or https: protocol`,
    ).toMatch(/^https?:$/);
    expect(parsedPhotoUrl?.hostname, `${location} photoUrl must include a hostname`).not.toBe('');
  });
});
