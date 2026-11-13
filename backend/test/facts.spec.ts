import {
  ageOn,
  isAllowedFactUrl,
  isPersonName,
  loadFactSheet,
  readBirth,
  readEntityIds,
  readFallbackFx,
  readFrankfurter,
  readIntro,
  readLabels,
  readOpenSearchTitle,
  readOpenSearchTitles,
  readSummary,
  titleMatchesPerson,
  wikiLangsFor,
} from '../src/ai/facts';

const summary = {
  type: 'standard',
  title: 'Andrzej Duda',
  description: 'Polish politician, president of Poland 2015–2025',
  extract: 'Andrzej Sebastian Duda is a Polish politician born 16 May 1972.',
  wikibase_item: 'Q152512',
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Andrzej_Duda' } },
};

describe('fact sheet parsing', () => {
  it('accepts a Wikipedia summary only when the title is the same person', () => {
    expect(readSummary('Andrzej Duda', summary)?.source).toBe('https://en.wikipedia.org/wiki/Andrzej_Duda');
    expect(readSummary('Andrzej Duda', { ...summary, type: 'disambiguation' })).toBeNull();
    expect(readSummary('Other Person', summary)).toBeNull();
    expect(titleMatchesPerson('Jean-Claude Juncker', 'Jean-Claude Juncker')).toBe(true);
    expect(isPersonName('Andrzej Duda')).toBe(true);
    expect(isPersonName('https://evil.test')).toBe(false);
  });

  it('reads a day-precision birth date and the age on the check date', () => {
    const birth = readBirth({
      claims: { P569: [{ mainsnak: { datavalue: { value: { time: '+1972-05-16T00:00:00Z', precision: 11 } } } }] },
    });
    expect(birth).toEqual({ iso: '1972-05-16', precision: 11 });
    expect(ageOn('1972-05-16', '2026-10-27')).toBe(54);
    expect(ageOn('1972-05-16', '2026-05-01')).toBe(53);
    expect(readBirth({ claims: { P569: [{ mainsnak: { datavalue: { value: { time: '+1972-00-00T00:00:00Z', precision: 9 } } } }] } })?.iso).toBe(
      '1972-01-01',
    );
  });

  it('reads citizenship, offices and the article intro', () => {
    const claims = {
      claims: {
        P27: [
          { rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q36' } } } },
          { rank: 'preferred', mainsnak: { datavalue: { value: { id: 'Q36' } } } },
        ],
      },
    };
    expect(readEntityIds(claims)).toEqual(['Q36']);
    expect(readLabels({ entities: { Q36: { labels: { en: { value: 'Poland' } } } } })).toEqual({ Q36: 'Poland' });
    expect(readIntro({ query: { pages: { 1: { extract: '  Lead paragraph. ' } } } })).toBe('Lead paragraph.');
  });

  it('reads USD cross rates and ignores anything else', () => {
    expect(
      readFrankfurter({ base: 'USD', date: '2026-10-24', rates: { EUR: 0.92, PLN: 3.95, USD: 1, BAD: 1, XXX: 0 } }),
    ).toEqual({ date: '2026-10-24', base: 'USD', rates: { EUR: 0.92, PLN: 3.95 } });
    expect(readFrankfurter({ base: 'EUR', date: '2026-10-24', rates: { USD: 1.1 } })).toBeNull();
  });

  it('loads the person card and the rates from the allowed hosts only', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('page/summary')) {
        return new Response(JSON.stringify(summary), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (href.includes('wbgetclaims')) {
        return new Response(
          JSON.stringify({ claims: { P569: [{ mainsnak: { datavalue: { value: { time: '+1972-05-16T00:00:00Z', precision: 11 } } } }] } }),
          { status: 200 },
        );
      }
      if (href.includes('frankfurter.app')) {
        return new Response(JSON.stringify({ base: 'USD', date: '2026-10-24', rates: { PLN: 4 } }), { status: 200 });
      }
      return new Response('no', { status: 404 });
    };
    const sheet = await loadFactSheet({ person: 'Andrzej Duda', checkDate: '2026-10-27' }, fetchImpl);
    expect(sheet.person).toMatchObject({
      name: 'Andrzej Duda',
      born: '1972-05-16',
      age_on_check_date: 54,
      source: 'https://en.wikipedia.org/wiki/Andrzej_Duda',
      citizenship: [],
      positions: [],
    });
    expect(sheet.fx).toEqual({ date: '2026-10-24', base: 'USD', rates: { PLN: 4 } });
    expect(calls.every((href) => href.startsWith('https://en.wikipedia.org/') || href.startsWith('https://www.wikidata.org/') || href.startsWith('https://api.frankfurter.app/'))).toBe(true);
    await expect(loadFactSheet({ person: 'x', checkDate: '2026-10-27' }, fetchImpl)).resolves.toMatchObject({ person: null });
  });

  it('fills citizenship and positions from fixture JSON and drops deprecated claims', () => {
    const citizenship = readEntityIds({
      claims: {
        P27: [
          { rank: 'deprecated', mainsnak: { datavalue: { value: { id: 'Q8' } } } },
          { rank: 'preferred', mainsnak: { datavalue: { value: { id: 'Q55' } } } },
        ],
      },
    });
    const positions = readEntityIds({
      claims: {
        P39: [
          { rank: 'deprecated', mainsnak: { datavalue: { value: { id: 'Q9' } } } },
          { rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q100' } } } },
        ],
      },
    });
    const labels = readLabels(
      {
        entities: {
          Q55: { labels: { nl: { value: 'Nederland' }, en: { value: 'Netherlands' } } },
          Q100: { labels: { en: { value: 'entrepreneur' } } },
          Q8: { labels: { en: { value: 'Old land' } } },
          Q9: { labels: { en: { value: 'Old post' } } },
        },
      },
      ['nl', 'en'],
    );
    expect(citizenship.map((id) => labels[id])).toEqual(['Nederland']);
    expect(positions.map((id) => labels[id])).toEqual(['entrepreneur']);
  });

  it('reads a fallback FX payload as units per 1 USD, including EUR', () => {
    expect(
      readFallbackFx({ result: 'success', base_code: 'USD', date: '2026-10-24', rates: { EUR: 0.92, USD: 1, XXX: 3 } }),
    ).toEqual({ date: '2026-10-24', base: 'USD', rates: { EUR: 0.92 } });
    const converted = readFallbackFx({
      base_code: 'EUR',
      date: '2026-10-24',
      rates: { USD: 1.25, EUR: 1, GBP: 0.86 },
    });
    expect(converted?.base).toBe('USD');
    expect(converted?.date).toBe('2026-10-24');
    expect(converted?.rates.EUR).toBeCloseTo(1 / 1.25);
    expect(converted?.rates.GBP).toBeCloseTo(0.86 / 1.25);
    expect(readFallbackFx({ result: 'error', base_code: 'USD', date: '2026-10-24', rates: { EUR: 0.92 } })).toBeNull();
    expect(readFallbackFx({ base_code: 'EUR', date: '2026-10-24', rates: { GBP: 0.86 } })).toBeNull();
  });

  it('rejects a host that is not on the fact allowlist', () => {
    expect(isAllowedFactUrl('https://evil.test/latest?from=USD')).toBe(false);
    expect(isAllowedFactUrl('https://en.wikipedia.org.evil.test/wiki/Ben_Woldring')).toBe(false);
    expect(isAllowedFactUrl('https://xx.wikipedia.org/wiki/Ben_Woldring')).toBe(false);
    expect(isAllowedFactUrl('http://api.frankfurter.app/latest?from=USD')).toBe(false);
    expect(isAllowedFactUrl('https://user:pass@api.frankfurter.app/latest?from=USD')).toBe(false);
    expect(isAllowedFactUrl('https://api.frankfurter.app/latest?from=USD')).toBe(true);
    expect(isAllowedFactUrl('https://open.er-api.com/v6/latest/USD')).toBe(true);
    expect(isAllowedFactUrl('https://nl.wikipedia.org/wiki/Ben_Woldring')).toBe(true);
    expect(isAllowedFactUrl('https://www.wikidata.org/wiki/Q123')).toBe(true);
    expect(wikiLangsFor(['nl-NL', 'de'])).toEqual(['nl', 'de', 'en']);
    expect(wikiLangsFor(['xx'])).toEqual(['en']);
  });

  it('loads a Dutch person card and falls back to an allowlisted FX feed', async () => {
    const calls: string[] = [];
    let frankfurter = 0;
    let fallback = 0;
    const dutch = {
      type: 'standard',
      title: 'Ben Woldring',
      description: 'Nederlands ondernemer',
      extract: 'Ben Woldring is a Dutch entrepreneur.',
      wikibase_item: 'Q123',
      content_urls: { desktop: { page: 'https://nl.wikipedia.org/wiki/Ben_Woldring' } },
    };
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      calls.push(href);
      if (!isAllowedFactUrl(href)) return new Response('blocked', { status: 599 });
      if (href.startsWith('https://nl.wikipedia.org/api/rest_v1/page/summary/')) {
        return new Response(JSON.stringify(dutch), { status: 200 });
      }
      if (href.includes('property=P569')) {
        return new Response(
          JSON.stringify({
            claims: { P569: [{ mainsnak: { datavalue: { value: { time: '+1974-05-24T00:00:00Z', precision: 11 } } } }] },
          }),
          { status: 200 },
        );
      }
      if (href.includes('property=P27')) {
        return new Response(
          JSON.stringify({ claims: { P27: [{ rank: 'preferred', mainsnak: { datavalue: { value: { id: 'Q55' } } } }] } }),
          { status: 200 },
        );
      }
      if (href.includes('property=P39')) {
        return new Response(
          JSON.stringify({
            claims: {
              P39: [
                { rank: 'deprecated', mainsnak: { datavalue: { value: { id: 'Q8' } } } },
                { rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q100' } } } },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (href.includes('props=labels')) {
        return new Response(
          JSON.stringify({
            entities: {
              Q55: { labels: { nl: { value: 'Nederland' }, en: { value: 'Netherlands' } } },
              Q100: { labels: { en: { value: 'entrepreneur' } } },
              Q8: { labels: { en: { value: 'Old post' } } },
            },
          }),
          { status: 200 },
        );
      }
      if (href.startsWith('https://api.frankfurter.app/')) {
        frankfurter += 1;
        return new Response('no', { status: 503 });
      }
      if (href.startsWith('https://open.er-api.com/')) {
        fallback += 1;
        return new Response(
          JSON.stringify({ result: 'success', base_code: 'USD', date: '2026-10-24', rates: { EUR: 0.92, USD: 1, PLN: 4 } }),
          { status: 200 },
        );
      }
      return new Response('no', { status: 404 });
    };
    const sheet = await loadFactSheet({ person: 'Ben Woldring', checkDate: '2026-10-27', languages: ['nl'] }, fetchImpl);
    expect(sheet.person).toMatchObject({
      name: 'Ben Woldring',
      source: 'https://nl.wikipedia.org/wiki/Ben_Woldring',
      born: '1974-05-24',
      age_on_check_date: 52,
      citizenship: ['Nederland'],
      positions: ['entrepreneur'],
    });
    expect(sheet.fx).toEqual({ date: '2026-10-24', base: 'USD', rates: { EUR: 0.92, PLN: 4 } });
    expect(frankfurter).toBe(2);
    expect(fallback).toBe(1);
    expect(calls.some((href) => href.startsWith('https://nl.wikipedia.org/'))).toBe(true);
    expect(calls.some((href) => href.startsWith('https://en.wikipedia.org/'))).toBe(false);
    expect(calls.every((href) => isAllowedFactUrl(href))).toBe(true);
  });

  it('leaves fx null when Frankfurter and the fallback both fail', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response('no', { status: 503 });
    };
    await expect(loadFactSheet({ person: null, checkDate: '2026-10-27' }, fetchImpl)).resolves.toEqual({
      person: null,
      fx: null,
    });
    expect(calls).toBe(4);
  });

  it('uses an English summary when Dutch misses, and Wikidata when both summaries miss', async () => {
    const english = {
      type: 'standard',
      title: 'Ben Woldring',
      description: 'Dutch entrepreneur',
      extract: 'Ben Woldring is a Dutch entrepreneur.',
      wikibase_item: 'Q123',
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Ben_Woldring' } },
    };
    expect(readSummary('Ben Woldring', english)?.source).toBe('https://en.wikipedia.org/wiki/Ben_Woldring');
    expect(
      readSummary('Ben Woldring', { ...english, content_urls: { desktop: { page: 'https://evil.test/wiki/Ben_Woldring' } } }),
    ).toBeNull();
    const birth = {
      claims: { P569: [{ mainsnak: { datavalue: { value: { time: '+1974-05-24T00:00:00Z', precision: 11 } } } }] },
    };
    const citizenship = { claims: { P27: [{ rank: 'preferred', mainsnak: { datavalue: { value: { id: 'Q55' } } } }] } };
    const positions = { claims: { P39: [{ rank: 'normal', mainsnak: { datavalue: { value: { id: 'Q100' } } } }] } };
    const labels = {
      entities: {
        Q55: { labels: { en: { value: 'Netherlands' } } },
        Q100: { labels: { en: { value: 'entrepreneur' } } },
      },
    };
    const fx = { base: 'USD', date: '2026-10-27', rates: { EUR: 0.9 } };
    const route = (mode: 'en' | 'wd'): typeof fetch => async (url) => {
      const href = String(url);
      if (!isAllowedFactUrl(href)) throw new Error(href);
      if (href.includes('property=P569')) return new Response(JSON.stringify(birth), { status: 200 });
      if (href.includes('property=P27')) return new Response(JSON.stringify(citizenship), { status: 200 });
      if (href.includes('property=P39')) return new Response(JSON.stringify(positions), { status: 200 });
      if (href.includes('props=labels')) return new Response(JSON.stringify(labels), { status: 200 });
      if (href.startsWith('https://api.frankfurter.app/')) return new Response(JSON.stringify(fx), { status: 200 });
      if (mode === 'en' && href.startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/')) {
        return new Response(JSON.stringify(english), { status: 200 });
      }
      if (mode === 'wd' && href.includes('wbsearchentities')) {
        return new Response(
          JSON.stringify({ search: [{ id: 'Q123', label: 'Ben Woldring', description: 'Dutch entrepreneur' }] }),
          { status: 200 },
        );
      }
      if (mode === 'wd' && href.includes('sitelinks')) {
        return new Response(
          JSON.stringify({
            entities: {
              Q123: {
                descriptions: { en: { value: 'Dutch entrepreneur' } },
                sitelinks: { enwiki: { title: 'Ben Woldring' } },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response('no', { status: 404 });
    };
    const viaEnglish = await loadFactSheet({ person: 'Ben Woldring', checkDate: '2026-10-27', languages: ['nl'] }, route('en'));
    expect(viaEnglish.person).toMatchObject({
      source: 'https://en.wikipedia.org/wiki/Ben_Woldring',
      description: 'Dutch entrepreneur',
      citizenship: ['Netherlands'],
      positions: ['entrepreneur'],
      born: '1974-05-24',
    });
    const viaWikidata = await loadFactSheet({ person: 'Ben Woldring', checkDate: '2026-10-27', languages: ['nl'] }, route('wd'));
    expect(viaWikidata.person).toMatchObject({
      name: 'Ben Woldring',
      source: 'https://www.wikidata.org/wiki/Q123',
      description: 'Dutch entrepreneur',
      citizenship: ['Netherlands'],
      positions: ['entrepreneur'],
    });
  });

  it('reads every opensearch title and keeps the first-title helper', () => {
    const body = ['Jan Kowalski', ['Jan Kowalski', '  ', 'Jan Kowalski (politician)', 'Jan Kowalski'], [], []];
    expect(readOpenSearchTitles(body)).toEqual(['Jan Kowalski', 'Jan Kowalski (politician)']);
    expect(readOpenSearchTitle(body)).toBe('Jan Kowalski');
    expect(readOpenSearchTitle(['Jan Kowalski', ['  ', 'Jan Kowalski (politician)'], [], []])).toBeNull();
  });

  it('skips a dead namesake and returns the living person in the landing GEO', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('action=opensearch')) {
        return factJson(['Jan Kowalski', ['Jan Kowalski', 'Jan Kowalski (politician)', 'Unrelated'], [], []]);
      }
      if (href.includes('/page/summary/')) {
        const title = summaryTitle(href);
        if (title === 'Jan Kowalski') return factJson(personSummary('Jan Kowalski', 'Q1', 'Polish historian'));
        if (title === 'Jan Kowalski (politician)') return factJson(personSummary('Jan Kowalski (politician)', 'Q2', 'Polish politician'));
        return new Response('no', { status: 404 });
      }
      const claim = claimQuery(href);
      if (claim?.entity === 'Q1' && claim.property === 'P570') return factJson(timeClaim('P570', '+1901-03-03T00:00:00Z'));
      if (claim?.entity === 'Q1' && claim.property === 'P569') return factJson(timeClaim('P569', '+1850-01-01T00:00:00Z'));
      if (claim?.entity === 'Q1' && claim.property === 'P27') return factJson(idClaim('P27', 'Q36'));
      if (claim?.entity === 'Q2' && claim.property === 'P570') return factJson({ claims: {} });
      if (claim?.entity === 'Q2' && claim.property === 'P569') return factJson(timeClaim('P569', '+1980-04-02T00:00:00Z'));
      if (claim?.entity === 'Q2' && claim.property === 'P27') return factJson(idClaim('P27', 'Q36'));
      if (claim?.entity === 'Q36' && claim.property === 'P297') return factJson(isoClaim('PL'));
      if (href.includes('props=labels')) return factJson({ entities: { Q36: { labels: { en: { value: 'Poland' } } } } });
      if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
      return new Response('no', { status: 404 });
    };
    const sheet = await loadFactSheet({ person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'] }, fetchImpl);
    expect(sheet.person).toMatchObject({
      name: 'Jan Kowalski (politician)',
      born: '1980-04-02',
      age_on_check_date: 46,
      citizenship: ['Poland'],
      source: 'https://en.wikipedia.org/wiki/Jan_Kowalski_(politician)',
    });
    expect(calls.some((href) => href.includes('action=opensearch') && href.includes('limit=5'))).toBe(true);
    expect(calls.some((href) => href.includes('entity=Q1') && href.includes('property=P570'))).toBe(true);
    expect(calls.some((href) => href.includes('Unrelated'))).toBe(false);
  });

  it('skips a living person from another country when a later candidate matches the GEO', async () => {
    const american = { id: 'Q1001', label: 'Mina Hart', description: 'American singer' };
    const canadian = { id: 'Q1002', label: 'Mina Hart', description: 'Canadian singer' };
    const both = await loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27', countries: ['CA'] }, minaFetch([american, canadian]));
    expect(both.person).toMatchObject({
      name: 'Mina Hart',
      source: 'https://www.wikidata.org/wiki/Q1002',
      description: 'Canadian singer',
      born: '1991-07-07',
      citizenship: ['Canada'],
    });
    const foreignOnly = await loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27', countries: ['CA'] }, minaFetch([american]));
    expect(foreignOnly.person).toBeNull();
  });

  it('returns no person when the only namesake is dead', async () => {
    const onDate = '2026-10-27';
    await expect(loadFactSheet({ person: 'Jan Kowalski', checkDate: onDate, countries: ['PL'] }, deadFetch('+1901-03-03T00:00:00Z'))).resolves.toMatchObject({
      person: null,
    });
    await expect(
      loadFactSheet({ person: 'Jan Kowalski', checkDate: onDate, countries: ['PL'] }, deadFetch('+2026-00-00T00:00:00Z', 9)),
    ).resolves.toMatchObject({ person: null });
    await expect(
      loadFactSheet({ person: 'Jan Kowalski', checkDate: onDate, countries: ['Poland'] }, deadFetch('+2026-10-27T00:00:00Z')),
    ).resolves.toMatchObject({ person: null });
  });

  it('returns a living person when GEO is omitted and a missing death claim is not death', async () => {
    let p297 = 0;
    let death: 'failed' | 'later' = 'failed';
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      if (href.includes('property=P297')) p297 += 1;
      if (href.includes('/page/summary/')) return factJson(personSummary('Mina Hart', 'Q1002', 'Canadian singer'));
      const claim = claimQuery(href);
      if (claim?.property === 'P570') {
        if (death === 'failed') return new Response('no', { status: 503 });
        return factJson(timeClaim('P570', '+2026-12-01T00:00:00Z'));
      }
      if (claim?.property === 'P569') return factJson(timeClaim('P569', '+1991-07-07T00:00:00Z'));
      if (claim?.property === 'P27') return factJson(idClaim('P27', 'Q16'));
      if (href.includes('props=labels')) return factJson({ entities: { Q16: { labels: { en: { value: 'Canada' } } } } });
      if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
      return new Response('no', { status: 404 });
    };
    const omitted = await loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27' }, fetchImpl);
    expect(omitted.person).toMatchObject({ name: 'Mina Hart', born: '1991-07-07', citizenship: ['Canada'] });
    const emptyGeo = await loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27', countries: [] }, fetchImpl);
    expect(emptyGeo.person?.name).toBe('Mina Hart');
    expect(p297).toBe(0);
    death = 'later';
    const later = await loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27' }, fetchImpl);
    expect(later.person?.name).toBe('Mina Hart');
    expect(p297).toBe(0);
  });

  it('matches GEO by ISO code or country label and ignores a shared dial code', async () => {
    await expect(
      loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27', countries: ['CA'] }, geoFetch('iso-beats-label')),
    ).resolves.toMatchObject({ person: null });
    const byLabel = await loadFactSheet(
      { person: 'Mina Hart', checkDate: '2026-10-27', countries: ['CA'], languages: ['ru'] },
      geoFetch('label'),
    );
    expect(byLabel.person).toMatchObject({ name: 'Mina Hart', citizenship: ['Канада'] });
    await expect(
      loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27', countries: ['+1'] }, geoFetch('dial')),
    ).resolves.toMatchObject({ person: null });
    const byRussianName = await loadFactSheet(
      { person: 'Mina Hart', checkDate: '2026-10-27', countries: ['Польша'] },
      geoFetch('russian-name'),
    );
    expect(byRussianName.person).toMatchObject({ citizenship: ['Poland'] });
    await expect(
      loadFactSheet({ person: 'Mina Hart', checkDate: '2026-10-27', countries: ['PL'] }, geoFetch('no-citizenship')),
    ).resolves.toMatchObject({ person: null });
  });
});

describe('deepseek person search', () => {
  const apiKey = 'test-search-key';
  const search = { baseUrl: 'https://api.deepseek.com', apiKey };
  const summaryText = 'Jan Kowalski (1950) is a politician in Poland.';
  const living = {
    rerank_score: 2.4,
    authority: 4,
    title: 'Jan Kowalski — polityk',
    url: 'https://example.pl/people/jan-kowalski',
    snippet: '',
    summary: summaryText,
    content: 'DO NOT USE THIS CONTENT Jan Kowalski died',
    site_name: 'Not The Title',
  };

  function searchOnly(results: unknown): typeof fetch {
    return async (url) => {
      const href = String(url);
      if (href.includes('/tools/search')) return factJson({ results });
      if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
      return new Response('no', { status: 404 });
    };
  }

  async function capturingSearch(results: unknown, countries: readonly string[]) {
    const requests: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const href = String(url);
      if (href.includes('/tools/search')) {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return factJson({ results });
      }
      if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
      return new Response('no', { status: 404 });
    };
    const sheet = await loadFactSheet(
      { person: 'Jan Kowalski', checkDate: '2026-10-27', countries, search },
      fetchImpl,
    );
    return { requests, sheet };
  }

  it('fills the card from a living high-authority hit when Wikipedia misses', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const href = String(url);
      urls.push(href);
      if (href.includes('/tools/search')) {
        seen.push({ url: href, init });
        return factJson({ results: [living] });
      }
      if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
      return new Response('no', { status: 404 });
    };
    const sheet = await loadFactSheet(
      { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search },
      fetchImpl,
    );
    expect(sheet.person).toMatchObject({
      name: 'Jan Kowalski',
      source: 'https://example.pl/people/jan-kowalski',
      description: 'Jan Kowalski — polityk',
      born: null,
      age_on_check_date: null,
      positions: [],
    });
    expect(sheet.person?.extract).toContain(summaryText);
    expect(sheet.person?.extract).not.toContain('DO NOT USE');
    expect(sheet.person?.citizenship).toContain('Poland');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(seen[0].url.endsWith('/v1/tools/search')).toBe(true);
    expect(seen[0].url).not.toContain(apiKey);
    expect(seen[0].init?.method).toBe('POST');
    expect(new Headers(seen[0].init?.headers).get('authorization')).toBe(`Bearer ${apiKey}`);
    expect(new Headers(seen[0].init?.headers).get('content-type')).toBe('application/json');
    const body = JSON.parse(String(seen[0].init?.body)) as Record<string, unknown>;
    expect(body.need_content).toBe(false);
    expect(body.count).toBe(8);
    expect(body.localization).toBeUndefined();
    expect(String(body.query).length).toBeLessThanOrEqual(128);
    expect(body.query).toContain('Jan Kowalski');
    expect(body.query).toContain('Poland');
    expect(body.query).toBe('"Jan Kowalski" Poland living');
    expect(body.ori_question).toBe('Is Jan Kowalski alive in Poland?');
    expect(String(seen[0].init?.body)).not.toContain(apiKey);
    expect(urls.some((href) => href.includes('example.pl'))).toBe(false);
  });

  it('builds the search path on a /v1 base and retries one 429', async () => {
    const seen: string[] = [];
    let searches = 0;
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      if (!href.includes('/tools/search')) return new Response('no', { status: 404 });
      searches += 1;
      seen.push(href);
      if (searches === 1) return new Response('rate', { status: 429 });
      return factJson({ results: [living] });
    };
    const sheet = await loadFactSheet(
      {
        person: 'Jan Kowalski',
        checkDate: '2026-10-27',
        countries: ['PL'],
        search: { baseUrl: 'https://api.deepseek.com/v1/', apiKey },
      },
      fetchImpl,
    );
    expect(searches).toBe(2);
    expect(seen.every((href) => href === 'https://api.deepseek.com/v1/tools/search')).toBe(true);
    expect(seen.some((href) => href.includes('/v1/v1/'))).toBe(false);
    expect(sheet.person?.source).toBe(living.url);
    expect(sheet.person?.citizenship).toContain('Poland');
  });

  it('drops obituaries and lifespans that end before the check year', async () => {
    const dead = [
      {
        rerank_score: 2.8,
        authority: 4,
        title: 'Obituary: Jan Kowalski',
        url: 'https://example.pl/obituary',
        snippet: 'Jan Kowalski passed away in Poland.',
        summary: 'Jan Kowalski died in Poland.',
      },
      {
        rerank_score: 2.2,
        authority: 3,
        title: 'Jan Kowalski (1950-2019)',
        url: 'https://example.pl/life',
        snippet: '',
        summary: 'Jan Kowalski (1950–2019) worked in Poland.',
      },
      {
        rerank_score: 2,
        authority: 4,
        title: 'Jan Kowalski',
        url: 'https://example.pl/ru',
        snippet: '',
        summary: 'Jan Kowalski умер в Poland.',
      },
    ];
    const sheet = await loadFactSheet(
      { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search },
      searchOnly(dead),
    );
    expect(sheet.person).toBeNull();
  });

  it('rejects a namesake from another country and a bare PL code', async () => {
    const hits = [
      {
        rerank_score: 2.9,
        authority: 4,
        title: 'Jan Kowalski',
        url: 'https://news.example.pl/jan-kowalski',
        snippet: 'Jan Kowalski PL exclusive',
        summary: 'Jan Kowalski is a singer in Germany.',
      },
      {
        rerank_score: 2.1,
        authority: 3,
        title: 'Jan Kowalski',
        url: 'https://example.de/polish',
        snippet: '',
        summary: 'Jan Kowalski is a Polish singer.',
      },
    ];
    const sheet = await loadFactSheet(
      { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search },
      searchOnly(hits),
    );
    expect(sheet.person).toBeNull();
  });

  it('does not search when Wikidata already returned a person', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('/page/summary/')) return factJson(summary);
      if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
      if (href.includes('/tools/search')) return factJson({ results: [living] });
      return new Response('no', { status: 404 });
    };
    const sheet = await loadFactSheet(
      { person: 'Andrzej Duda', checkDate: '2026-10-27', search },
      fetchImpl,
    );
    expect(sheet.person).toMatchObject({
      name: 'Andrzej Duda',
      source: 'https://en.wikipedia.org/wiki/Andrzej_Duda',
    });
    expect(calls.some((href) => href.includes('/tools/search'))).toBe(false);
  });

  it('stays null and does not call search without credentials', async () => {
    const tracked = (label: string, calls: string[]): typeof fetch => async (url) => {
      const href = String(url);
      calls.push(`${label}:${href}`);
      if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
      return new Response('no', { status: 404 });
    };
    const plain: string[] = [];
    const emptyKey: string[] = [];
    const blankKey: string[] = [];
    const httpBase: string[] = [];
    await expect(loadFactSheet({ person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'] }, tracked('plain', plain))).resolves.toMatchObject({
      person: null,
    });
    await expect(
      loadFactSheet(
        { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search: null },
        tracked('empty', emptyKey),
      ),
    ).resolves.toMatchObject({ person: null });
    await expect(
      loadFactSheet(
        { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search: { baseUrl: 'https://api.deepseek.com', apiKey: '   ' } },
        tracked('blank', blankKey),
      ),
    ).resolves.toMatchObject({ person: null });
    await expect(
      loadFactSheet(
        { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search: { baseUrl: 'http://api.deepseek.com', apiKey } },
        tracked('http', httpBase),
      ),
    ).resolves.toMatchObject({ person: null });
    for (const calls of [plain, emptyKey, blankKey, httpBase]) {
      expect(calls.some((href) => href.includes('/v1/tools/search'))).toBe(false);
    }
  });

  it('keeps a weaker local hit, prefers a strong one, and shapes the query from the country name', async () => {
    const weak = {
      rerank_score: 1.1,
      authority: 1,
      title: '',
      url: 'https://local.example/jan-kowalski',
      snippet: 'Jan Kowalski lives in Poland.',
      summary: '',
      site_name: 'Gazeta',
    };
    const weakOnly = await loadFactSheet(
      { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search },
      searchOnly([weak]),
    );
    expect(weakOnly.person).toMatchObject({
      source: weak.url,
      description: 'Gazeta',
      born: null,
      positions: [],
    });
    expect(weakOnly.person?.extract).toContain('Jan Kowalski lives in Poland.');
    expect(weakOnly.person?.citizenship).toContain('Poland');

    const tooWeak = await loadFactSheet(
      { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search },
      searchOnly([{ ...weak, rerank_score: 0.4, authority: 1 }]),
    );
    expect(tooWeak.person).toBeNull();

    const strong = { ...living, rerank_score: 2.2, authority: 2, url: 'https://best.example/jan-kowalski', summary: 'BEST Jan Kowalski lives in Poland.' };
    const ranked = await loadFactSheet(
      { person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search },
      searchOnly([weak, strong]),
    );
    expect(ranked.person?.source).toBe(strong.url);
    expect(ranked.person?.extract).toBe('BEST Jan Kowalski lives in Poland.');

    const sentence = await capturingSearch(
      [{ ...living, summary: 'Jan Kowalski serves Poland. Extra sentence.', title: ' ', site_name: '' }],
      ['Польша'],
    );
    expect(sentence.requests[0]?.query).toBe('"Jan Kowalski" Польша living');
    expect(sentence.requests[0]?.ori_question).toBe('Is Jan Kowalski alive in Польша?');
    expect(sentence.sheet.person?.description).toBe('Jan Kowalski serves Poland.');
    expect(sentence.sheet.person?.citizenship).toContain('Poland');

    const germany = await capturingSearch(
      [{ ...living, summary: 'Jan Kowalski lives in Germany.', url: 'https://example.de/jan-kowalski' }],
      ['DE', 'PL'],
    );
    expect(germany.requests[0]?.query).toBe('"Jan Kowalski" Germany living');
    expect(germany.sheet.person?.citizenship).toContain('Germany');

    const dial = await capturingSearch([living], ['+48', 'PL']);
    expect(dial.requests[0]?.query).toBe('"Jan Kowalski" Poland living');
    expect(String(dial.requests[0]?.query)).not.toContain('+48');

    const open = await capturingSearch(
      [{ ...living, summary: 'Jan Kowalski is a public figure.', url: 'https://example.com/jan-kowalski' }],
      [],
    );
    expect(open.requests[0]?.query).toBe('"Jan Kowalski" living');
    expect(open.requests[0]?.ori_question).toBeUndefined();
    expect(open.sheet.person?.source).toBe('https://example.com/jan-kowalski');
    expect(open.sheet.person?.citizenship).toEqual([]);
  });

  it('returns no hits on a client error without a second try and survives a thrown search', async () => {
    let calls = 0;
    const once: typeof fetch = async (url) => {
      if (!String(url).includes('/tools/search')) return new Response('no', { status: 404 });
      calls += 1;
      return new Response('bad', { status: 400 });
    };
    await expect(
      loadFactSheet({ person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search }, once),
    ).resolves.toMatchObject({ person: null });
    expect(calls).toBe(1);

    const thrown: typeof fetch = async (url) => {
      if (String(url).includes('/tools/search')) throw new Error(`down ${apiKey}`);
      return new Response('no', { status: 404 });
    };
    await expect(
      loadFactSheet({ person: 'Jan Kowalski', checkDate: '2026-10-27', countries: ['PL'], search }, thrown),
    ).resolves.toMatchObject({ person: null });
  });
});

function factJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fxJson(): Response {
  return factJson({ base: 'USD', date: '2026-10-24', rates: { EUR: 0.92, PLN: 4, CAD: 1.36 } });
}

function personSummary(title: string, qid: string, description: string, lang = 'en') {
  return {
    type: 'standard',
    title,
    description,
    extract: `${title} is described here.`,
    wikibase_item: qid,
    content_urls: { desktop: { page: `https://${lang}.wikipedia.org/wiki/${title.replace(/ /g, '_')}` } },
  };
}

function timeClaim(property: string, time: string, precision = 11) {
  return { claims: { [property]: [{ mainsnak: { datavalue: { value: { time, precision } } } }] } };
}

function idClaim(property: string, id: string) {
  return { claims: { [property]: [{ rank: 'preferred', mainsnak: { datavalue: { value: { id } } } }] } };
}

function isoClaim(code: string) {
  return { claims: { P297: [{ rank: 'normal', mainsnak: { datavalue: { value: code, type: 'string' } } }] } };
}

function summaryTitle(href: string): string {
  const marker = '/page/summary/';
  const at = href.indexOf(marker);
  if (at < 0) return '';
  return decodeURIComponent(href.slice(at + marker.length)).replace(/_/g, ' ');
}

function claimQuery(href: string): { entity: string; property: string } | null {
  if (!href.includes('action=wbgetclaims')) return null;
  const url = new URL(href);
  const entity = url.searchParams.get('entity') ?? '';
  const property = url.searchParams.get('property') ?? '';
  if (!entity || !property) return null;
  return { entity, property };
}

function minaFetch(hits: { id: string; label: string; description: string }[]): typeof fetch {
  return async (url) => {
    const href = String(url);
    if (href.includes('wbsearchentities')) return factJson({ search: hits });
    const claim = claimQuery(href);
    if (claim?.entity === 'Q1001' && claim.property === 'P570') return factJson({ claims: {} });
    if (claim?.entity === 'Q1002' && claim.property === 'P570') return factJson({ claims: {} });
    if (claim?.entity === 'Q1001' && claim.property === 'P569') return factJson(timeClaim('P569', '+1984-02-02T00:00:00Z'));
    if (claim?.entity === 'Q1002' && claim.property === 'P569') return factJson(timeClaim('P569', '+1991-07-07T00:00:00Z'));
    if (claim?.entity === 'Q1001' && claim.property === 'P27') return factJson(idClaim('P27', 'Q30'));
    if (claim?.entity === 'Q1002' && claim.property === 'P27') return factJson(idClaim('P27', 'Q16'));
    if (claim?.entity === 'Q30' && claim.property === 'P297') return factJson(isoClaim('US'));
    if (claim?.entity === 'Q16' && claim.property === 'P297') return factJson(isoClaim('CA'));
    if (href.includes('props=labels')) {
      return factJson({
        entities: {
          Q30: { labels: { en: { value: 'United States' } } },
          Q16: { labels: { en: { value: 'Canada' } } },
        },
      });
    }
    if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
    return new Response('no', { status: 404 });
  };
}

function deadFetch(time: string, precision = 11): typeof fetch {
  return async (url) => {
    const href = String(url);
    if (href.includes('/page/summary/')) return factJson(personSummary('Jan Kowalski', 'Q1', 'Polish historian'));
    const claim = claimQuery(href);
    if (claim?.property === 'P570') return factJson(timeClaim('P570', time, precision));
    if (claim?.property === 'P569') return factJson(timeClaim('P569', '+1850-01-01T00:00:00Z'));
    if (claim?.property === 'P27') return factJson(idClaim('P27', 'Q36'));
    if (claim?.property === 'P297') return factJson(isoClaim('PL'));
    if (href.includes('props=labels')) return factJson({ entities: { Q36: { labels: { en: { value: 'Poland' } } } } });
    if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
    return new Response('no', { status: 404 });
  };
}

type GeoMode = 'iso-beats-label' | 'label' | 'dial' | 'russian-name' | 'no-citizenship';

function geoFetch(mode: GeoMode): typeof fetch {
  return async (url) => {
    const href = String(url);
    if (href.includes('/page/summary/')) return factJson(personSummary('Mina Hart', 'Q1002', 'public person', mode === 'label' ? 'ru' : 'en'));
    const claim = claimQuery(href);
    if (claim?.property === 'P570') return factJson({ claims: {} });
    if (claim?.property === 'P569') return factJson(timeClaim('P569', '+1991-07-07T00:00:00Z'));
    if (claim?.property === 'P27') {
      if (mode === 'no-citizenship') return new Response('no', { status: 503 });
      if (mode === 'iso-beats-label') return factJson(idClaim('P27', 'Q30'));
      if (mode === 'russian-name') return factJson(idClaim('P27', 'Q36'));
      return factJson(idClaim('P27', 'Q16'));
    }
    if (claim?.property === 'P297') {
      if (mode === 'label') return new Response('no', { status: 404 });
      if (mode === 'iso-beats-label') return factJson(isoClaim('US'));
      if (mode === 'russian-name') return factJson(isoClaim('PL'));
      return factJson(isoClaim('CA'));
    }
    if (href.includes('props=labels')) {
      if (mode === 'label') return factJson({ entities: { Q16: { labels: { ru: { value: 'Канада' } } } } });
      if (mode === 'iso-beats-label') return factJson({ entities: { Q30: { labels: { en: { value: 'Canada' } } } } });
      if (mode === 'russian-name') return factJson({ entities: { Q36: { labels: { en: { value: 'Poland' }, ru: { value: 'Польша' } } } } });
      return factJson({ entities: { Q16: { labels: { en: { value: 'Canada' } } } } });
    }
    if (href.startsWith('https://api.frankfurter.app/')) return fxJson();
    return new Response('no', { status: 404 });
  };
}
