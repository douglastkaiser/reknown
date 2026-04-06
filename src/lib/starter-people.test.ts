import { describe, expect, it } from 'vitest';
import { starterPeople } from './starter-people';

describe('starter people photos', () => {
  it('provides a photo URL for every seeded person', () => {
    expect(starterPeople.length).toBeGreaterThan(0);
    for (const starter of starterPeople) {
      expect(starter.photoUrl).toBeTypeOf('string');
      expect(starter.photoUrl?.trim().length).toBeGreaterThan(0);
    }
  });

  it('ensures face-based seeded card payloads always include an image source', () => {
    const seededFaceCardSources = starterPeople.map((starter) => ({
      face_to_name: starter.photoUrl,
      name_to_face: starter.photoUrl,
    }));

    for (const source of seededFaceCardSources) {
      expect(source.face_to_name?.trim().length).toBeGreaterThan(0);
      expect(source.name_to_face?.trim().length).toBeGreaterThan(0);
    }
  });
});
