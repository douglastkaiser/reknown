(function initPhotoIntegrity(globalScope) {
  const PHOTO_INTEGRITY_SPEC = {
    photoHashAlgorithm: 'sha256',
    photoHashInput: 'data_url_utf8',
    photoHashPrefixLen: 12,
  };

  function normalizeDataUrlUtf8(dataUrl) {
    return new TextEncoder().encode(String(dataUrl || '').normalize('NFC'));
  }

  function toHexPrefix(buffer, prefixLen) {
    const digestBytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < digestBytes.length; i++) {
      hex += digestBytes[i].toString(16).padStart(2, '0');
      if (hex.length >= prefixLen) break;
    }
    return hex.slice(0, prefixLen);
  }

  async function computePhotoHashPrefixFromDataUrl(dataUrl, prefixLen) {
    const len = Math.max(8, Math.min(64, prefixLen || PHOTO_INTEGRITY_SPEC.photoHashPrefixLen));
    if (!globalScope.crypto || !globalScope.crypto.subtle) return null;
    const normalizedBytes = normalizeDataUrlUtf8(dataUrl);
    const digest = await globalScope.crypto.subtle.digest('SHA-256', normalizedBytes);
    return toHexPrefix(digest, len);
  }

  globalScope.REKNOWN_PHOTO_INTEGRITY = {
    PHOTO_INTEGRITY_SPEC,
    computePhotoHashPrefixFromDataUrl,
  };
})(globalThis);
