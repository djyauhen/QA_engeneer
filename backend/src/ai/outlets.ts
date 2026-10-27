export const OUTLET_HEADER_REF = 'outlet_header';
export const OUTLET_FOOTER_REF = 'outlet_footer';
export const LANDING_FOOTER_REF = 'landing_footer';

/** One hostname mention is enough. A bare logo token must repeat, so a single aside does not pick the outlet. */
const HOST_WEIGHT = 10;
const PHRASE_WEIGHT = 6;
const TOKEN_WEIGHT = 2;
const MIN_SCORE = 6;

export interface OutletSite {
  name: string;
  url: string;
  hosts: string[];
  phrases: string[];
  tokens: string[];
}

export const OUTLET_SITES: readonly OutletSite[] = [
  { name: 'NOS', url: 'https://nos.nl', hosts: ['nos.nl'], phrases: [], tokens: ['NOS'] },
  { name: 'NU.nl', url: 'https://www.nu.nl', hosts: ['nu.nl'], phrases: ['NU.nl'], tokens: [] },
  { name: 'RTL Nieuws', url: 'https://www.rtlnieuws.nl', hosts: ['rtlnieuws.nl'], phrases: ['RTL Nieuws'], tokens: [] },
  { name: 'Algemeen Dagblad', url: 'https://www.ad.nl', hosts: ['ad.nl'], phrases: ['Algemeen Dagblad'], tokens: [] },
  { name: 'De Telegraaf', url: 'https://www.telegraaf.nl', hosts: ['telegraaf.nl'], phrases: ['De Telegraaf'], tokens: [] },
  { name: 'NRC', url: 'https://www.nrc.nl', hosts: ['nrc.nl'], phrases: ['NRC Handelsblad'], tokens: [] },
  { name: 'Bild', url: 'https://www.bild.de', hosts: ['bild.de'], phrases: [], tokens: [] },
  { name: 'Der Spiegel', url: 'https://www.spiegel.de', hosts: ['spiegel.de'], phrases: ['Der Spiegel'], tokens: [] },
  { name: 'Die Welt', url: 'https://www.welt.de', hosts: ['welt.de'], phrases: ['Die Welt'], tokens: [] },
  { name: 'n-tv', url: 'https://www.n-tv.de', hosts: ['n-tv.de'], phrases: ['n-tv'], tokens: [] },
  { name: 'BBC', url: 'https://www.bbc.com', hosts: ['bbc.com', 'bbc.co.uk'], phrases: ['BBC News'], tokens: ['BBC'] },
  { name: 'Daily Mail', url: 'https://www.dailymail.co.uk', hosts: ['dailymail.co.uk'], phrases: ['Daily Mail'], tokens: [] },
  { name: 'The Guardian', url: 'https://www.theguardian.com', hosts: ['theguardian.com'], phrases: ['The Guardian'], tokens: [] },
  { name: 'Sky News', url: 'https://news.sky.com', hosts: ['news.sky.com'], phrases: ['Sky News'], tokens: [] },
  { name: 'CNN', url: 'https://www.cnn.com', hosts: ['cnn.com'], phrases: [], tokens: ['CNN'] },
  { name: 'Fox News', url: 'https://www.foxnews.com', hosts: ['foxnews.com'], phrases: ['Fox News'], tokens: [] },
  { name: 'NBC News', url: 'https://www.nbcnews.com', hosts: ['nbcnews.com'], phrases: ['NBC News'], tokens: [] },
  { name: 'USA Today', url: 'https://www.usatoday.com', hosts: ['usatoday.com'], phrases: ['USA Today'], tokens: [] },
  { name: 'Le Monde', url: 'https://www.lemonde.fr', hosts: ['lemonde.fr'], phrases: ['Le Monde'], tokens: [] },
  { name: 'Le Figaro', url: 'https://www.lefigaro.fr', hosts: ['lefigaro.fr'], phrases: ['Le Figaro'], tokens: [] },
  { name: 'BFMTV', url: 'https://www.bfmtv.com', hosts: ['bfmtv.com'], phrases: ['BFMTV'], tokens: [] },
  { name: 'El País', url: 'https://elpais.com', hosts: ['elpais.com'], phrases: ['El País', 'El Pais'], tokens: [] },
  { name: 'Corriere della Sera', url: 'https://www.corriere.it', hosts: ['corriere.it'], phrases: ['Corriere della Sera'], tokens: [] },
  { name: 'La Repubblica', url: 'https://www.repubblica.it', hosts: ['repubblica.it'], phrases: ['La Repubblica'], tokens: [] },
  { name: 'Aftonbladet', url: 'https://www.aftonbladet.se', hosts: ['aftonbladet.se'], phrases: ['Aftonbladet'], tokens: [] },
  { name: 'Expressen', url: 'https://www.expressen.se', hosts: ['expressen.se'], phrases: ['Expressen'], tokens: [] },
  { name: 'VG', url: 'https://www.vg.no', hosts: ['vg.no'], phrases: ['Verdens Gang'], tokens: [] },
  { name: 'Ekstra Bladet', url: 'https://ekstrabladet.dk', hosts: ['ekstrabladet.dk'], phrases: ['Ekstra Bladet'], tokens: [] },
  { name: 'Onet', url: 'https://www.onet.pl', hosts: ['onet.pl'], phrases: [], tokens: [] },
  { name: 'TVN24', url: 'https://tvn24.pl', hosts: ['tvn24.pl'], phrases: ['TVN24'], tokens: [] },
  { name: 'CBC', url: 'https://www.cbc.ca', hosts: ['cbc.ca'], phrases: [], tokens: ['CBC'] },
  { name: 'CTV News', url: 'https://www.ctvnews.ca', hosts: ['ctvnews.ca'], phrases: ['CTV News'], tokens: [] },
];

export interface OutletMatch {
  name: string;
  url: string;
}

export function matchOutlet(text: string): OutletMatch | null {
  let best: { site: OutletSite; score: number; at: number } | null = null;
  for (const site of OUTLET_SITES) {
    const score = scoreSite(text, site);
    if (score < MIN_SCORE) continue;
    const at = earliestAt(text, site);
    if (!best || score > best.score || (score === best.score && at < best.at)) best = { site, score, at };
  }
  return best ? { name: best.site.name, url: best.site.url } : null;
}

export function isAllowedOutletUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  if (parsed.search || parsed.hash) return false;
  const key = originKey(parsed);
  return OUTLET_SITES.some((site) => originKey(new URL(site.url)) === key);
}

function scoreSite(text: string, site: OutletSite): number {
  let score = 0;
  for (const host of site.hosts) score += countHosts(text, host) * HOST_WEIGHT;
  for (const phrase of site.phrases) score += countBounded(text, phrase, true) * PHRASE_WEIGHT;
  for (const token of site.tokens) score += countBounded(text, token, false) * TOKEN_WEIGHT;
  return score;
}

function earliestAt(text: string, site: OutletSite): number {
  const lower = text.toLowerCase();
  let at = Number.MAX_SAFE_INTEGER;
  for (const host of site.hosts) {
    const index = lower.indexOf(host.toLowerCase());
    if (index >= 0 && index < at) at = index;
  }
  for (const phrase of site.phrases) {
    const index = lower.indexOf(phrase.toLowerCase());
    if (index >= 0 && index < at) at = index;
  }
  for (const token of site.tokens) {
    const index = text.indexOf(token);
    if (index >= 0 && index < at) at = index;
  }
  return at;
}

function countHosts(text: string, host: string): number {
  const re = new RegExp(`(?<![\\w-])${escapeRegExp(host)}(?![\\w-])`, 'gi');
  return text.match(re)?.length ?? 0;
}

function countBounded(text: string, token: string, insensitive: boolean): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, insensitive ? 'giu' : 'gu');
  return text.match(re)?.length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function originKey(url: URL): string {
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.origin}${path}`;
}
