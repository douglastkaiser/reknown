import type { Person } from '../types';

export type DistractorStrategy = 'similar-first' | 'random';

function hasPhoto(person: Person): boolean {
  return Boolean(person.photoDataUrl || person.photoUrl);
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function descriptorScore(target: string[] | undefined, candidate: string[] | undefined): number {
  if (!target?.length || !candidate?.length) return 0;
  const targetSet = new Set(target);
  const candidateSet = new Set(candidate);
  let overlap = 0;
  for (const descriptor of targetSet) {
    if (candidateSet.has(descriptor)) overlap += 1;
  }
  const unionSize = new Set([...targetSet, ...candidateSet]).size;
  return unionSize ? overlap / unionSize : 0;
}

export function selectDistractors(
  targetPersonId: string,
  people: Person[],
  count: number,
  strategy: DistractorStrategy = 'similar-first'
): Person[] {
  if (count <= 0) return [];

  const byId = new Map(people.map((person) => [person.id, person]));
  const target = byId.get(targetPersonId);
  const candidates = people.filter((person) => person.id !== targetPersonId && hasPhoto(person));
  if (!candidates.length) return [];

  if (strategy === 'random' || !target) {
    return shuffle(candidates).slice(0, count);
  }

  const selectedIds = new Set<string>();
  const selected: Person[] = [];
  const pushCandidate = (person?: Person) => {
    if (!person || selectedIds.has(person.id) || person.id === targetPersonId || !hasPhoto(person)) return;
    selected.push(person);
    selectedIds.add(person.id);
  };

  for (const neighborId of target.similarity?.nearestNeighborIds ?? []) {
    pushCandidate(byId.get(neighborId));
    if (selected.length >= count) return selected;
  }

  const targetClusterIds = new Set(target.similarity?.clusterIds ?? []);
  if (targetClusterIds.size) {
    for (const person of candidates) {
      const clusterIds = person.similarity?.clusterIds ?? [];
      if (clusterIds.some((clusterId) => targetClusterIds.has(clusterId))) {
        pushCandidate(person);
      }
      if (selected.length >= count) return selected;
    }
  }

  const rankedByDescriptorSimilarity = [...candidates]
    .filter((person) => !selectedIds.has(person.id))
    .map((person) => ({
      person,
      score: descriptorScore(target.similarity?.normalizedDescriptors, person.similarity?.normalizedDescriptors),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const entry of rankedByDescriptorSimilarity) {
    pushCandidate(entry.person);
    if (selected.length >= count) return selected;
  }

  const remaining = shuffle(candidates.filter((person) => !selectedIds.has(person.id)));
  for (const person of remaining) {
    pushCandidate(person);
    if (selected.length >= count) return selected;
  }

  return selected;
}
