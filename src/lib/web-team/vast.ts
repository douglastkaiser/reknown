import type { WebTeamPersonRecord } from './types';

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function toAbsoluteUrl(value: string | null | undefined, baseUrl: string): string | undefined {
  const raw = clean(value);
  if (!raw) return undefined;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function parsePersonCard(card: Element, sourceUrl: string): WebTeamPersonRecord | null {
  const name = clean(
    card.querySelector('.team-grid-item__details h3, [data-team-item-animate] h3, h3')
      ?.textContent,
  );
  if (!name) return null;

  const headline = clean(
    card.querySelector('.team-grid-item__details h4, [data-team-item-animate] h4, h4')
      ?.textContent,
  );

  const photoUrl =
    toAbsoluteUrl(card.querySelector('.team-grid-item__img img, img.cover-img')?.getAttribute('src'), sourceUrl) ??
    toAbsoluteUrl(card.querySelector('img')?.getAttribute('src'), sourceUrl);

  const linkedInAnchor = card.querySelector<HTMLAnchorElement>('a[href*="linkedin.com"]');
  const fallbackAnchor = card.querySelector<HTMLAnchorElement>('a[href^="http"]');

  return {
    name,
    headline: headline || undefined,
    company: 'Vast',
    location: 'Long Beach, California',
    region: 'SoCal',
    photoUrl,
    link: toAbsoluteUrl(linkedInAnchor?.getAttribute('href') ?? fallbackAnchor?.getAttribute('href'), sourceUrl),
  };
}

export async function fetchAndParseVastTeamPage(url: string): Promise<WebTeamPersonRecord[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Vast team page error: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cards = Array.from(doc.querySelectorAll('.team-grid__item.w-dyn-item, .team-grid__item'));

  const deduped = new Map<string, WebTeamPersonRecord>();
  for (const card of cards) {
    const record = parsePersonCard(card, url);
    if (!record) continue;
    const key = `${record.name.toLowerCase()}::${(record.headline ?? '').toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, record);
    }
  }

  return Array.from(deduped.values());
}
