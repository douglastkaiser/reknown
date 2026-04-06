export async function resizeToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 400 / bitmap.width, 400 / bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export async function urlToData(url: string): Promise<string> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    const blob = await response.blob();
    return await resizeToJpeg(new File([blob], 'remote.jpg', { type: blob.type || 'image/jpeg' }));
  } catch {
    // CORS or network failure — fall back to the raw URL so the browser can
    // still render it via <img src>. The caller stores it in photoUrl.
    return url;
  }
}

export function googleImageSearchUrl(name: string, company?: string): string {
  const q = [name, company, 'LinkedIn'].filter(Boolean).join(' ');
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
}
