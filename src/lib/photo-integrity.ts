export type PhotoHashAlgorithm = 'sha256';
export type PhotoHashInput = 'data_url_utf8' | 'decoded_bytes';

export interface PhotoIntegritySpec {
  photoHashAlgorithm: PhotoHashAlgorithm;
  photoHashInput: PhotoHashInput;
  photoHashPrefixLen: number;
}

export const PHOTO_INTEGRITY_SPEC_V1: PhotoIntegritySpec = {
  photoHashAlgorithm: 'sha256',
  photoHashInput: 'data_url_utf8',
  photoHashPrefixLen: 12,
};

export const PHOTO_INTEGRITY_LEGACY_SPEC: PhotoIntegritySpec = {
  photoHashAlgorithm: 'sha256',
  photoHashInput: 'decoded_bytes',
  photoHashPrefixLen: 12,
};

function toHexPrefix(buffer: ArrayBuffer, prefixLen: number): string {
  const digestBytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < digestBytes.length; i++) {
    hex += digestBytes[i].toString(16).padStart(2, '0');
    if (hex.length >= prefixLen) break;
  }
  return hex.slice(0, prefixLen);
}

function normalizeDataUrlUtf8(dataUrl: string): Uint8Array {
  const normalized = String(dataUrl).normalize('NFC');
  return new TextEncoder().encode(normalized);
}

function decodeBase64BytesFromDataUrl(dataUrl: string): Uint8Array | null {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  const b64 = dataUrl.slice(commaIdx + 1);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function computeDataUrlSha256PrefixBySpec(
  dataUrl: string,
  spec: PhotoIntegritySpec,
): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    if (spec.photoHashAlgorithm !== 'sha256') return null;

    const inputBytes =
      spec.photoHashInput === 'data_url_utf8'
        ? normalizeDataUrlUtf8(dataUrl)
        : decodeBase64BytesFromDataUrl(dataUrl);

    if (!inputBytes) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', inputBytes as BufferSource);
    return toHexPrefix(digest, spec.photoHashPrefixLen);
  } catch {
    return null;
  }
}

export function matchesPhotoIntegritySpec(spec: Partial<PhotoIntegritySpec> | null | undefined): boolean {
  return !!spec &&
    spec.photoHashAlgorithm === PHOTO_INTEGRITY_SPEC_V1.photoHashAlgorithm &&
    spec.photoHashInput === PHOTO_INTEGRITY_SPEC_V1.photoHashInput &&
    spec.photoHashPrefixLen === PHOTO_INTEGRITY_SPEC_V1.photoHashPrefixLen;
}
