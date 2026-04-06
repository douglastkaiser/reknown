export function capitalizeName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function parseNicknames(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => capitalizeName(part))
    .filter((part) => part.length > 0);
}
