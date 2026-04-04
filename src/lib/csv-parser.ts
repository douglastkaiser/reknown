import type { CsvPersonRow } from '../types';

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')));
}

function headerMap(headers: string[]) {
  return headers.reduce<Record<string, number>>((acc, header, idx) => {
    acc[header.toLowerCase()] = idx;
    return acc;
  }, {});
}

export function parseLinkedInCsv(text: string): CsvPersonRow[] {
  const [headers, ...rows] = parseCsv(text);
  const map = headerMap(headers);

  return rows
    .map((row) => ({
      name: row[map['first name']] && row[map['last name']]
        ? `${row[map['first name']]} ${row[map['last name']]}`.trim()
        : row[map['name']] || '',
      headline: row[map['headline']] || '',
      company: row[map['company']] || row[map['position']] || '',
      linkedinUrl: row[map['profile url']] || row[map['url']] || '',
      photoUrl: row[map['image url']] || '',
      notes: row[map['notes']] || '',
    }))
    .filter((person) => person.name);
}

export function parseGenericCsv(text: string): CsvPersonRow[] {
  const [headers, ...rows] = parseCsv(text);
  const map = headerMap(headers);
  const pick = (row: string[], keys: string[], fallback = '') => {
    for (const key of keys) {
      const index = map[key];
      if (typeof index === 'number' && row[index]) return row[index];
    }
    return fallback;
  };

  return rows
    .map((row) => ({
      name: pick(row, ['name', 'full name', 'person']),
      headline: pick(row, ['headline', 'title', 'role']),
      company: pick(row, ['company', 'organization']),
      linkedinUrl: pick(row, ['linkedin', 'linkedin url', 'profile url']),
      photoUrl: pick(row, ['photo', 'photo url', 'image', 'image url']),
      notes: pick(row, ['notes', 'note']),
    }))
    .filter((person) => person.name);
}
