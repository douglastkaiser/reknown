import { describe, expect, it } from 'vitest';
import {
  PHOTO_INTEGRITY_LEGACY_SPEC,
  PHOTO_INTEGRITY_SPEC_V1,
  computeDataUrlSha256PrefixBySpec,
} from './photo-integrity';

const SAMPLE_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';

describe('photo integrity hashing', () => {
  it('matches extension hash prefix for v1 metadata spec', async () => {
    // @ts-expect-error test-only side-effect import from extension folder
    await import('../../extension/photo-integrity.js');
    const extensionApi = (globalThis as typeof globalThis & {
      REKNOWN_PHOTO_INTEGRITY?: {
        PHOTO_INTEGRITY_SPEC: {
          photoHashAlgorithm: 'sha256';
          photoHashInput: 'data_url_utf8';
          photoHashPrefixLen: number;
        };
        computePhotoHashPrefixFromDataUrl: (dataUrl: string, prefixLen?: number) => Promise<string | null>;
      };
    }).REKNOWN_PHOTO_INTEGRITY;

    expect(extensionApi).toBeTruthy();
    const extensionPrefix = await extensionApi!.computePhotoHashPrefixFromDataUrl(
      SAMPLE_DATA_URL,
      extensionApi!.PHOTO_INTEGRITY_SPEC.photoHashPrefixLen,
    );
    const appPrefix = await computeDataUrlSha256PrefixBySpec(SAMPLE_DATA_URL, PHOTO_INTEGRITY_SPEC_V1);

    expect(extensionPrefix).toBeTruthy();
    expect(appPrefix).toBe(extensionPrefix);
  });

  it('keeps legacy decoded-bytes hashing available for backward compatibility', async () => {
    const legacyPrefix = await computeDataUrlSha256PrefixBySpec(SAMPLE_DATA_URL, PHOTO_INTEGRITY_LEGACY_SPEC);
    const v1Prefix = await computeDataUrlSha256PrefixBySpec(SAMPLE_DATA_URL, PHOTO_INTEGRITY_SPEC_V1);

    expect(legacyPrefix).toBeTruthy();
    expect(v1Prefix).toBeTruthy();
    expect(legacyPrefix).not.toBe(v1Prefix);
  });
});
