import satyaNadellaPhotoUrl from '../assets/starter-people/satya-nadella.svg';
import taylorSwiftPhotoUrl from '../assets/starter-people/taylor-swift.svg';
import simoneBilesPhotoUrl from '../assets/starter-people/simone-biles.svg';
import jensenHuangPhotoUrl from '../assets/starter-people/jensen-huang.svg';
import serenaWilliamsPhotoUrl from '../assets/starter-people/serena-williams.svg';
import volodymyrZelenskyyPhotoUrl from '../assets/starter-people/volodymyr-zelenskyy.svg';
import timCookPhotoUrl from '../assets/starter-people/tim-cook.svg';
import meganRapinoePhotoUrl from '../assets/starter-people/megan-rapinoe.svg';
import type { CsvPersonRow } from '../types';

export const starterPeople: CsvPersonRow[] = [
  {
    name: 'Satya Nadella',
    headline: 'Chairman and CEO',
    company: 'Microsoft',
    photoUrl: satyaNadellaPhotoUrl,
    notes: 'Public-company leadership and AI platform strategy.',
  },
  {
    name: 'Taylor Swift',
    headline: 'Singer-songwriter and producer',
    company: 'Entertainment',
    photoUrl: taylorSwiftPhotoUrl,
    notes: 'Global touring artist with major fan engagement and brand partnerships.',
  },
  {
    name: 'Simone Biles',
    headline: 'Olympic gymnast',
    company: 'Team USA',
    photoUrl: simoneBilesPhotoUrl,
    notes: 'Decorated gymnast and mental-health advocate.',
  },
  {
    name: 'Jensen Huang',
    headline: 'President and CEO',
    company: 'NVIDIA',
    photoUrl: jensenHuangPhotoUrl,
    notes: 'Known for GPU and AI infrastructure leadership.',
  },
  {
    name: 'Serena Williams',
    headline: 'Former world No. 1 tennis player',
    company: 'Wyn Beauty / Serena Ventures',
    photoUrl: serenaWilliamsPhotoUrl,
    notes: 'Athlete and entrepreneur in beauty and venture investing.',
  },
  {
    name: 'Volodymyr Zelenskyy',
    headline: 'President',
    company: 'Ukraine',
    photoUrl: volodymyrZelenskyyPhotoUrl,
    notes: 'Head of state and frequent international diplomacy figure.',
  },
  {
    name: 'Tim Cook',
    headline: 'Chief Executive Officer',
    company: 'Apple',
    photoUrl: timCookPhotoUrl,
    notes: 'Leads Apple product ecosystem and operations strategy.',
  },
  {
    name: 'Megan Rapinoe',
    headline: 'Former professional soccer player',
    company: 'USWNT',
    photoUrl: meganRapinoePhotoUrl,
    notes: 'World Cup winner and equality advocate.',
  },
];
