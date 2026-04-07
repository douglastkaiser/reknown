import type { CsvPersonRow } from '../types';

// Real face photos sourced from Wikimedia Commons. We previously tried to
// hotlink Wikimedia's own thumbnails at upload.wikimedia.org/wikipedia/commons/
// thumb/.../640px-<File>, but Wikimedia's thumbnailer rejects many widths on a
// per-file basis ("Use thumbnail steps listed on https://w.wiki/GHai"), which
// kept breaking the guest-mode starter set.
//
// Instead we point at the full-size original file on upload.wikimedia.org
// (which has no thumbnail-rule restrictions and is always hotlinkable) and
// pipe it through the free images.weserv.nl image proxy, which downsizes it
// to 640px wide JPEG for the browser. This avoids both the thumbnail-bucket
// problem and shipping multi-MB originals.
//
//   https://images.weserv.nl/?url=upload.wikimedia.org/wikipedia/commons/<h[0]>/<h[0:2]>/<File>&w=640&output=jpg
//
// where <h> is the md5 hex of the filename (with underscores, not spaces).
// We precompute <h[0:2]> for each starter so the browser doesn't need crypto.
function commons(hash2: string, filename: string): string {
  const encoded = encodeURIComponent(filename);
  const source = `upload.wikimedia.org/wikipedia/commons/${hash2[0]}/${hash2}/${encoded}`;
  return `https://images.weserv.nl/?url=${source}&w=640&output=jpg`;
}

export const starterPeople: CsvPersonRow[] = [
  {
    name: 'Satya Nadella',
    headline: 'Chairman and CEO',
    company: 'Microsoft',
    photoUrl: commons('b3', 'Satya_Nadella_in_2023_(cropped).jpg'),
    notes: 'Public-company leadership and AI platform strategy.',
  },
  {
    name: 'Taylor Swift',
    headline: 'Singer-songwriter and producer',
    company: 'Entertainment',
    photoUrl: commons('b5', '191125_Taylor_Swift_at_the_2019_American_Music_Awards_(cropped).png'),
    notes: 'Global touring artist with major fan engagement and brand partnerships.',
  },
  {
    name: 'Simone Biles',
    headline: 'Olympic gymnast',
    company: 'Team USA',
    photoUrl: commons('25', 'Simone_Biles_at_the_2016_Olympics_all-around_gold_medal_podium_(28262782114)_(cropped).jpg'),
    notes: 'Decorated gymnast and mental-health advocate.',
  },
  {
    name: 'Jensen Huang',
    headline: 'President and CEO',
    company: 'NVIDIA',
    photoUrl: commons('33', 'Jensen_Huang_2024_(cropped).jpg'),
    notes: 'Known for GPU and AI infrastructure leadership.',
  },
  {
    name: 'Serena Williams',
    headline: 'Former world No. 1 tennis player',
    company: 'Serena Ventures',
    photoUrl: commons('9f', 'Serena_Williams_at_2013_US_Open_(cropped).jpg'),
    notes: 'Athlete and entrepreneur in beauty and venture investing.',
  },
  {
    name: 'Volodymyr Zelenskyy',
    headline: 'President',
    company: 'Ukraine',
    photoUrl: commons('b1', 'Volodymyr_Zelensky_Official_portrait_(cropped).jpg'),
    notes: 'Head of state and frequent international diplomacy figure.',
  },
  {
    name: 'Tim Cook',
    headline: 'Chief Executive Officer',
    company: 'Apple',
    photoUrl: commons('d5', 'Tim_Cook_2009_cropped.jpg'),
    notes: 'Leads Apple product ecosystem and operations strategy.',
  },
  {
    name: 'Megan Rapinoe',
    headline: 'Former professional soccer player',
    company: 'USWNT',
    photoUrl: commons('8f', 'Megan_Rapinoe_2019_(cropped).jpg'),
    notes: 'World Cup winner and equality advocate.',
  },
  {
    name: 'Barack Obama',
    headline: '44th President of the United States',
    company: 'Obama Foundation',
    photoUrl: commons('8d', 'President_Barack_Obama.jpg'),
    notes: 'Former US president and author.',
  },
  {
    name: 'Oprah Winfrey',
    headline: 'Media executive and philanthropist',
    company: 'OWN',
    photoUrl: commons('bf', 'Oprah_in_2014.jpg'),
    notes: 'Talk show host, producer, and media mogul.',
  },
  {
    name: 'Elon Musk',
    headline: 'CEO',
    company: 'Tesla, SpaceX',
    photoUrl: commons('34', 'Elon_Musk_Royal_Society_(crop2).jpg'),
    notes: 'Entrepreneur in EVs, space, and AI.',
  },
  {
    name: 'Beyoncé',
    headline: 'Singer and producer',
    company: 'Parkwood Entertainment',
    photoUrl: commons('f2', 'Beyonce_-_The_Formation_World_Tour,_at_Wembley_Stadium_in_London,_England.jpg'),
    notes: 'Grammy-winning artist and businesswoman.',
  },
  {
    name: 'LeBron James',
    headline: 'Professional basketball player',
    company: 'Los Angeles Lakers',
    photoUrl: commons('7a', 'LeBron_James_(51959977144)_(cropped2).jpg'),
    notes: 'NBA superstar and entrepreneur.',
  },
  {
    name: 'Keanu Reeves',
    headline: 'Actor',
    company: 'Hollywood',
    photoUrl: commons('f6', 'Reeves_at_2019_Comic_Con_(cropped).jpg'),
    notes: 'Actor known for The Matrix and John Wick.',
  },
  {
    name: 'Greta Thunberg',
    headline: 'Climate activist',
    company: 'Fridays for Future',
    photoUrl: commons('47', 'Greta_Thunberg_urges_MEPs_to_show_climate_leadership_(49618310531)_(cropped).jpg'),
    notes: 'Swedish environmental activist.',
  },
  {
    name: 'Rihanna',
    headline: 'Singer and entrepreneur',
    company: 'Fenty',
    photoUrl: commons('c2', 'Rihanna_Fenty_2018.png'),
    notes: 'Recording artist and founder of Fenty Beauty.',
  },
  {
    name: 'Cristiano Ronaldo',
    headline: 'Professional footballer',
    company: 'Al Nassr',
    photoUrl: commons('8c', 'Cristiano_Ronaldo_2018.jpg'),
    notes: 'Portuguese forward, multi Ballon d\u2019Or winner.',
  },
  {
    name: 'Lionel Messi',
    headline: 'Professional footballer',
    company: 'Inter Miami',
    photoUrl: commons('c1', 'Lionel_Messi_20180626.jpg'),
    notes: 'Argentine forward, World Cup winner.',
  },
  {
    name: 'Angela Merkel',
    headline: 'Former Chancellor',
    company: 'Germany',
    photoUrl: commons('bf', 'Angela_Merkel._Tallinn_Digital_Summit.jpg'),
    notes: 'Long-serving German chancellor.',
  },
  {
    name: 'Bill Gates',
    headline: 'Co-founder',
    company: 'Microsoft / Gates Foundation',
    photoUrl: commons('a8', 'Bill_Gates_2017_(cropped).jpg'),
    notes: 'Microsoft co-founder and philanthropist.',
  },
];
