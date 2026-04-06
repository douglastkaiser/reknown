import type { CsvPersonRow } from '../types';

// Real face photos sourced from Wikimedia Commons. We use the
// `Special:FilePath` redirect endpoint with a `width` query, which is the
// documented hotlink-friendly way to fetch images from Commons. It always
// resolves to the latest version and is more reliable than hashed thumbnail
// URLs (which can rot). The Review UI applies object-cover with a face-biased
// object-position to get a tight head/face crop.
const COMMONS = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
function commons(filename: string): string {
  return `${COMMONS}${encodeURIComponent(filename)}?width=480`;
}

export const starterPeople: CsvPersonRow[] = [
  {
    name: 'Satya Nadella',
    headline: 'Chairman and CEO',
    company: 'Microsoft',
    photoUrl: commons('Satya_Nadella_in_2023_(cropped).jpg'),
    notes: 'Public-company leadership and AI platform strategy.',
  },
  {
    name: 'Taylor Swift',
    headline: 'Singer-songwriter and producer',
    company: 'Entertainment',
    photoUrl: commons('191125_Taylor_Swift_at_the_2019_American_Music_Awards_(cropped).png'),
    notes: 'Global touring artist with major fan engagement and brand partnerships.',
  },
  {
    name: 'Simone Biles',
    headline: 'Olympic gymnast',
    company: 'Team USA',
    photoUrl: commons('Simone_Biles_at_the_2016_Olympics_all-around_gold_medal_podium_(28262782114)_(cropped).jpg'),
    notes: 'Decorated gymnast and mental-health advocate.',
  },
  {
    name: 'Jensen Huang',
    headline: 'President and CEO',
    company: 'NVIDIA',
    photoUrl: commons('Jensen_Huang_2024_(cropped).jpg'),
    notes: 'Known for GPU and AI infrastructure leadership.',
  },
  {
    name: 'Serena Williams',
    headline: 'Former world No. 1 tennis player',
    company: 'Serena Ventures',
    photoUrl: commons('Serena_Williams_at_2013_US_Open_(cropped).jpg'),
    notes: 'Athlete and entrepreneur in beauty and venture investing.',
  },
  {
    name: 'Volodymyr Zelenskyy',
    headline: 'President',
    company: 'Ukraine',
    photoUrl: commons('Volodymyr_Zelensky_Official_portrait_(cropped).jpg'),
    notes: 'Head of state and frequent international diplomacy figure.',
  },
  {
    name: 'Tim Cook',
    headline: 'Chief Executive Officer',
    company: 'Apple',
    photoUrl: commons('Tim_Cook_2009_cropped.jpg'),
    notes: 'Leads Apple product ecosystem and operations strategy.',
  },
  {
    name: 'Megan Rapinoe',
    headline: 'Former professional soccer player',
    company: 'USWNT',
    photoUrl: commons('Megan_Rapinoe_2019_(cropped).jpg'),
    notes: 'World Cup winner and equality advocate.',
  },
  {
    name: 'Barack Obama',
    headline: '44th President of the United States',
    company: 'Obama Foundation',
    photoUrl: commons('President_Barack_Obama.jpg'),
    notes: 'Former US president and author.',
  },
  {
    name: 'Oprah Winfrey',
    headline: 'Media executive and philanthropist',
    company: 'OWN',
    photoUrl: commons('Oprah_in_2014.jpg'),
    notes: 'Talk show host, producer, and media mogul.',
  },
  {
    name: 'Elon Musk',
    headline: 'CEO',
    company: 'Tesla, SpaceX',
    photoUrl: commons('Elon_Musk_Royal_Society_(crop2).jpg'),
    notes: 'Entrepreneur in EVs, space, and AI.',
  },
  {
    name: 'Beyoncé',
    headline: 'Singer and producer',
    company: 'Parkwood Entertainment',
    photoUrl: commons('Beyonce_-_The_Formation_World_Tour,_at_Wembley_Stadium_in_London,_England.jpg'),
    notes: 'Grammy-winning artist and businesswoman.',
  },
  {
    name: 'LeBron James',
    headline: 'Professional basketball player',
    company: 'Los Angeles Lakers',
    photoUrl: commons('LeBron_James_(51959977144)_(cropped2).jpg'),
    notes: 'NBA superstar and entrepreneur.',
  },
  {
    name: 'Keanu Reeves',
    headline: 'Actor',
    company: 'Hollywood',
    photoUrl: commons('Reeves_at_2019_Comic_Con_(cropped).jpg'),
    notes: 'Actor known for The Matrix and John Wick.',
  },
  {
    name: 'Greta Thunberg',
    headline: 'Climate activist',
    company: 'Fridays for Future',
    photoUrl: commons('Greta_Thunberg_urges_MEPs_to_show_climate_leadership_(49618310531)_(cropped).jpg'),
    notes: 'Swedish environmental activist.',
  },
  {
    name: 'Rihanna',
    headline: 'Singer and entrepreneur',
    company: 'Fenty',
    photoUrl: commons('Rihanna_Fenty_2018.png'),
    notes: 'Recording artist and founder of Fenty Beauty.',
  },
  {
    name: 'Cristiano Ronaldo',
    headline: 'Professional footballer',
    company: 'Al Nassr',
    photoUrl: commons('Cristiano_Ronaldo_2018.jpg'),
    notes: 'Portuguese forward, multi Ballon d\u2019Or winner.',
  },
  {
    name: 'Lionel Messi',
    headline: 'Professional footballer',
    company: 'Inter Miami',
    photoUrl: commons('Lionel_Messi_20180626.jpg'),
    notes: 'Argentine forward, World Cup winner.',
  },
  {
    name: 'Angela Merkel',
    headline: 'Former Chancellor',
    company: 'Germany',
    photoUrl: commons('Angela_Merkel._Tallinn_Digital_Summit.jpg'),
    notes: 'Long-serving German chancellor.',
  },
  {
    name: 'Bill Gates',
    headline: 'Co-founder',
    company: 'Microsoft / Gates Foundation',
    photoUrl: commons('Bill_Gates_2017_(cropped).jpg'),
    notes: 'Microsoft co-founder and philanthropist.',
  },
];
