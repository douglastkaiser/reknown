import { describe, expect, it } from 'vitest';
import { starterPeople } from './starter-people';

describe('starter people', () => {
  it('has at least one seeded person', () => {
    expect(starterPeople.length).toBeGreaterThan(0);
  });

  it('any provided photoUrl is a non-empty string', () => {
    for (const starter of starterPeople) {
      if (starter.photoUrl !== undefined) {
        expect(starter.photoUrl).toBeTypeOf('string');
        expect(starter.photoUrl.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
