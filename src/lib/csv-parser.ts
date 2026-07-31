import type { CsvPersonRow } from '../types';
import { inferPersonRegion } from './regions';

// RFC4180-ish line tokenizer that handles quoted fields with embedded commas
// and escaped double quotes ("").
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

// LinkedIn's "Download my data" Connections.csv begins with a "Notes:" preamble
// followed by a blank line and then the real header row. Strip everything until
// we see a header line that contains both "first name" and "last name".
function stripLinkedInPreamble(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('first name') && lower.includes('last name')) {
      return lines.slice(i).join('\n');
    }
  }
  return text;
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function headerMap(headers: string[]) {
  return headers.reduce<Record<string, number>>((acc, header, idx) => {
    acc[header.toLowerCase().trim()] = idx;
    return acc;
  }, {});
}

export function parseLinkedInCsv(text: string): CsvPersonRow[] {
  const stripped = stripLinkedInPreamble(text);
  const parsed = parseCsv(stripped);
  if (parsed.length === 0) return [];
  const [headers, ...rows] = parsed;
  const map = headerMap(headers);

  const has = (key: string) => typeof map[key] === 'number';
  // Require LinkedIn-shaped headers, otherwise let the generic parser take over.
  if (!has('first name') && !has('last name') && !has('name')) return [];

  return rows
    .map((row) => {
      const first = has('first name') ? row[map['first name']] : '';
      const last = has('last name') ? row[map['last name']] : '';
      const fullName = first || last ? `${first || ''} ${last || ''}`.trim() : (has('name') ? row[map['name']] : '');
      const location = (has('current location') ? row[map['current location']] : '') ||
        (has('location') ? row[map.location] : '') || (has('city') ? row[map.city] : '') || '';
      const region = (has('region') ? row[map.region] : '') || undefined;
      const company = (has('company') ? row[map['company']] : '') || '';
      return {
        name: fullName || '',
        // LinkedIn export uses "Position" for the job title; "Headline" only
        // exists in some exports. Prefer headline, fall back to position.
        headline: (has('headline') ? row[map['headline']] : '') || (has('position') ? row[map['position']] : '') || '',
        company,
        location,
        region: inferPersonRegion({ company, location, region }),
        linkedinUrl: (has('url') ? row[map['url']] : '') || (has('profile url') ? row[map['profile url']] : '') || '',
        // Connections.csv has no image url; older exports may include one.
        photoUrl: (has('image url') ? row[map['image url']] : '') || '',
        notes: (has('notes') ? row[map['notes']] : '') || '',
      };
    })
    .filter((person) => person.name);
}

export function parseGenericCsv(text: string): CsvPersonRow[] {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return [];
  const [headers, ...rows] = parsed;
  const map = headerMap(headers);
  const pick = (row: string[], keys: string[], fallback = '') => {
    for (const key of keys) {
      const index = map[key];
      if (typeof index === 'number' && row[index]) return row[index];
    }
    return fallback;
  };

  return rows
    .map((row) => {
      const company = pick(row, ['company', 'organization']);
      const location = pick(row, ['current location', 'location', 'city']);
      const region = pick(row, ['region']);
      return {
        name: pick(row, ['name', 'full name', 'person']),
        headline: pick(row, ['headline', 'title', 'role', 'position']), company, location,
        region: inferPersonRegion({ company, location, region }),
        linkedinUrl: pick(row, ['linkedin', 'linkedin url', 'profile url', 'url']),
        photoUrl: pick(row, ['photo', 'photo url', 'image', 'image url']),
        notes: pick(row, ['notes', 'note']),
      };
    })
    .filter((person) => person.name);
}
