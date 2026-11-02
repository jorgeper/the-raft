import type { WeatherKind } from './weather';
import type { Season } from './season';
import { VIBES, type VibeName } from './vibes';

/**
 * Photo sessions (photo mode: Enter): N photos of the world, each a different combination of where, when and how,
 * chosen for coverage. The places are the demo film's shots (the deep forest, the meadow and its oak, the pond, the
 * falls, the gorge, the coast and its whale, the herd, the river, the headland...), framed as the film frames them;
 * each photo then gets its own time of day, weather, season, vibe and lens.
 *
 * Only combinations that make a picture are drawn: each place has a profile (a forest interior is black at night; the
 * night shore looks up at the sky, which is empty by day; a long lens on a close subject is a smear), night skies are
 * clear (the stars and the northern lights), and rain falls on open land by day.
 *
 * Within those, every photo is the candidate (out of a few hundred) that adds the most that hasn't been seen yet:
 * each value of each dimension first, then pairs (this place at dusk, this place in snow, rain in the morning...).
 * So 10 photos already span the places, the times and the seasons, and 100 cover nearly every place in every light.
 *
 * Vibes are dealt out last: a little under half the photos get a stylized one (every one of them before any
 * repeats), only well-lit ones, since a grade on a dark frame goes black; the rest keep the tuned look (whimsical).
 */

export interface SessionShot {
  /** The demo shot's name or title. */
  label: string;
  duration: number;
  /** The shot brings its own lens (the 85 mm meadow, the long lens on the whale): keep it. */
  ownLens: boolean;
}

export interface TimeSlot {
  label: string;
  hours: number;
  /** Lit enough for a stylized vibe. */
  bright?: boolean;
  night?: boolean;
}

export const TIMES: TimeSlot[] = [
  { label: 'dawn', hours: 5.35 },
  { label: 'sunrise', hours: 6.3, bright: true },
  { label: 'morning', hours: 8.5, bright: true },
  { label: 'midday', hours: 12.5, bright: true },
  { label: 'afternoon', hours: 15.5, bright: true },
  { label: 'golden hour', hours: 18.2, bright: true },
  { label: 'sunset', hours: 19.3, bright: true },
  { label: 'dusk', hours: 20.6 },
  { label: 'twilight', hours: 21.5, night: true },
  { label: 'night', hours: 23.4, night: true },
];
const T = (...labels: string[]) => TIMES.filter((t) => labels.includes(t.label));
const DAY = T('sunrise', 'morning', 'midday', 'afternoon', 'golden hour', 'sunset');

interface Place {
  /** For captions and file names. */
  name: string;
  times: TimeSlot[];
  /** Takes a 50 or 85 mm lens (the subject is far enough off). */
  tele?: boolean;
  /** Open land and sky, where rain reads as weather rather than murk. */
  open?: boolean;
}

/** The demo's shots as places for photos, by the shot's name or title. */
const PLACES: Record<string, Place> = {
  dawn: { name: 'Out at sea', times: [...T('dawn'), ...DAY, ...T('dusk')], open: true },
  'The deep forest': { name: 'The deep forest', times: DAY },
  'Spores and pollen': { name: 'Ferns and spores', times: DAY },
  'Under the canopy': { name: 'Under the canopy', times: DAY },
  'Dusk in the woods': { name: 'The woods', times: DAY },
  'The meadows': { name: 'The meadows', times: TIMES, tele: true, open: true },
  'A real lens': { name: 'Meadow flowers', times: [...T('dawn'), ...DAY] },
  'Real rock': { name: 'The gorge walls', times: [...T('dawn'), ...DAY, ...T('dusk')] },
  'The coast': { name: 'The coast', times: DAY, open: true },
  'A day': { name: 'The headland', times: TIMES, tele: true, open: true },
  Spring: { name: 'The wood edge', times: [...T('dawn'), ...DAY, ...T('dusk')], tele: true, open: true },
  Vibes: { name: 'The giant oak', times: TIMES, tele: true, open: true },
  'The pond': { name: 'The pond', times: [...DAY, ...T('dusk')] },
  Weather: { name: 'The coastal hills', times: TIMES, open: true },
  Waterfalls: { name: 'The waterfall', times: [...T('dawn'), ...DAY] },
  'Down the river': { name: 'Down the river', times: [...T('dawn'), ...DAY, ...T('dusk')], tele: true, open: true },
  'The herd': { name: 'The herd', times: DAY, tele: true, open: true },
  'Photo mode': { name: 'The surf', times: [...T('dawn'), ...DAY, ...T('dusk')], open: true },
  sunset: { name: 'Over the land', times: TIMES, open: true },
  Night: { name: 'The night shore', times: T('dawn', 'dusk', 'twilight', 'night'), tele: true, open: true },
};
const placeOf = (label: string): Place => PLACES[label] ?? { name: label, times: [...T('dawn'), ...DAY, ...T('dusk')] };

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export interface Lens {
  label: string;
  focal: number;
  fStop: number;
}
/** null: the usual view, no depth of field. */
const WIDE: (Lens | null)[] = [null, { label: '24 mm', focal: 24, fStop: 8 }, { label: '35 mm', focal: 35, fStop: 2 }];
const TELE: Lens[] = [{ label: '50 mm', focal: 50, fStop: 1.8 }, { label: '85 mm', focal: 85, fStop: 1.4 }];

export interface PhotoPlan {
  shot: number;
  /** Seconds into the shot to frame it (the settling time comes on top). */
  at: number;
  time: TimeSlot;
  weather: WeatherKind;
  season: Season;
  vibe: VibeName;
  /** undefined: the shot's own lens; null: none. */
  lens: Lens | null | undefined;
  /** Northern lights at night. */
  aurora: number | null;
  /** For people: "The herd · sunset · spring · fair · 50 mm". */
  caption: string;
  /** For the file: 07-the-herd-sunset-spring-fair-whimsical-50mm. */
  name: string;
}

/** A small seeded generator (mulberry32), so a session can be replayed from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Where in a shot a photo can be framed: past the fade in, and for some shots when the subject is in view. */
function frameWindow(s: SessionShot): [number, number] {
  if (s.label === 'The herd') return [10, 23];
  if (s.label === 'The coast') return [2.6, 4.5];
  return [1.2, Math.max(s.duration - 2.5, 1.5)];
}

/** Plans `count` photos over `shots` for the widest coverage. */
export function planSession(count: number, shots: SessionShot[], seed: number): PhotoPlan[] {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const shuffle = <T>(xs: T[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  const counts = new Map<string, number>();
  const seen = (k: string) => counts.get(k) ?? 0;

  const candidate = () => {
    const shot = Math.floor(r() * shots.length);
    const place = placeOf(shots[shot].label);
    const time = pick(place.times);
    const season = pick(SEASONS);
    // Night skies clear (stars, the aurora); rain on open land by day; snow only in winter, and no rain then.
    const weathers: WeatherKind[] = time.night
      ? ['clear', 'fair']
      : season === 'winter'
        ? ['clear', 'fair', 'cloudy', 'overcast', 'snow']
        : ['clear', 'fair', 'cloudy', 'overcast', ...(place.open && time.bright ? (['rain'] as WeatherKind[]) : [])];
    const lens = shots[shot].ownLens ? undefined : pick(place.tele ? [...WIDE, ...TELE] : WIDE);
    return { shot, place, time, season, weather: pick(weathers), lens };
  };
  type C = ReturnType<typeof candidate>;
  const keys = (c: C): [string, string, string][] => {
    const loc = String(c.shot), lens = c.lens === undefined ? 'own' : c.lens?.label ?? 'none';
    return [
      ['loc', loc, ''], ['time', c.time.label, ''], ['weather', c.weather, ''], ['season', c.season, ''], ['lens', lens, ''],
      ['loc×time', loc, c.time.label], ['loc×season', loc, c.season], ['loc×weather', loc, c.weather],
      ['time×weather', c.time.label, c.weather], ['time×season', c.time.label, c.season],
    ];
  };
  // Fair skies come up more often than the heavy weather: they count for less each time they're used.
  const weight = (dim: string, v: string) => (dim === 'weather' && (v === 'clear' || v === 'fair') ? 0.6 : 1);
  const score = (c: C) => {
    let s = r() * 0.01;
    for (const [dim, a, b] of keys(c)) s += (b ? 0.35 : 1) / (1 + seen(`${dim}:${a}:${b}`));
    return s;
  };

  const chosen: C[] = [];
  for (let i = 0; i < count; i++) {
    let best: C | null = null, bestScore = -1;
    for (let k = 0; k < 400; k++) {
      const c = candidate();
      const s = score(c);
      if (s > bestScore) [best, bestScore] = [c, s];
    }
    for (const [dim, a, b] of keys(best!)) counts.set(`${dim}:${a}:${b}`, seen(`${dim}:${a}:${b}`) + (b ? 1 : weight(dim, a)));
    chosen.push(best!);
  }

  // The vibes, dealt to the well-lit photos: whole shuffled rounds of the stylized ones.
  const lit = shuffle(chosen.map((c, i) => ({ c, i })).filter(({ c }) => c.time.bright && c.weather !== 'overcast' && c.weather !== 'rain'));
  const styled = Math.min(Math.round(count * 0.45), lit.length);
  const stylized = (Object.keys(VIBES) as VibeName[]).filter((v) => v !== 'whimsical');
  const deck: VibeName[] = [];
  while (deck.length < styled) deck.push(...shuffle([...stylized]));
  const vibes = Array<VibeName>(count).fill('whimsical');
  lit.slice(0, styled).forEach(({ i }, k) => (vibes[i] = deck[k]));

  return chosen.map((c, i) => {
    const s = shots[c.shot];
    const [lo, hi] = frameWindow(s);
    const vibe = vibes[i];
    const parts = [c.place.name, c.time.label, c.season, c.weather, ...(vibe === 'whimsical' ? [] : [vibe]), ...(c.lens ? [c.lens.label] : [])];
    return {
      shot: c.shot,
      at: lo + r() * (hi - lo),
      time: c.time,
      weather: c.weather,
      season: c.season,
      vibe,
      lens: c.lens,
      aurora: c.time.night || c.time.label === 'dusk' ? 0.8 + r() * 0.7 : null,
      caption: parts.join(' · '),
      name: `${String(i + 1).padStart(2, '0')}-${slug([c.place.name, c.time.label, c.season, c.weather, vibe, ...(c.lens ? [c.lens.label] : [])].join(' '))}`,
    };
  });
}
