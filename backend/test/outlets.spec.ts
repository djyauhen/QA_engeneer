import { assembleOutletReference, captureOutletReference, captureQaSurfaces, clipDocumentRegion } from '../src/ai/outlet-capture';
import { isAllowedOutletUrl, matchOutlet } from '../src/ai/outlets';

describe('outlet homepage match', () => {
  it('picks NOS from a repeated logo token or from the hostname', () => {
    expect(matchOutlet('NOS NOS NOS Nieuws')).toEqual({ name: 'NOS', url: 'https://nos.nl' });
    expect(matchOutlet('Bron: https://nos.nl/artikel')).toEqual({ name: 'NOS', url: 'https://nos.nl' });
    expect(matchOutlet('nos amis')).toBeNull();
    expect(matchOutlet('NOS')).toBeNull();
  });

  it('prefers the outlet named most often', () => {
    const text = 'NOS NOS NOS. BBC mentioned once.';
    expect(matchOutlet(text)?.name).toBe('NOS');
  });

  it('recognizes a distinctive masthead phrase', () => {
    expect(matchOutlet('Шапка De Telegraaf')).toEqual({ name: 'De Telegraaf', url: 'https://www.telegraaf.nl' });
  });

  it('allows only catalog homepages', () => {
    expect(isAllowedOutletUrl('https://nos.nl')).toBe(true);
    expect(isAllowedOutletUrl('https://nos.nl?t=secret')).toBe(false);
    expect(isAllowedOutletUrl('https://nos.nl/')).toBe(true);
    expect(isAllowedOutletUrl('https://www.nos.nl')).toBe(false);
    expect(isAllowedOutletUrl('https://nos.nl/nieuws')).toBe(false);
    expect(isAllowedOutletUrl('https://nos.nl.evil.test')).toBe(false);
    expect(isAllowedOutletUrl('http://nos.nl')).toBe(false);
    expect(isAllowedOutletUrl('https://user:pass@nos.nl')).toBe(false);
  });
});

describe('outlet capture guard', () => {
  it('does not launch a browser for an unknown site or an empty chrome path', async () => {
    await expect(
      captureOutletReference({ chromePath: 'C:\\missing\\chrome.exe', outletUrl: 'https://evil.test', standUrl: 'http://127.0.0.1' }),
    ).resolves.toBeNull();
    await expect(
      captureOutletReference({ chromePath: '  ', outletUrl: 'https://nos.nl', standUrl: null }),
    ).resolves.toBeNull();
    await expect(
      captureQaSurfaces({
        chromePath: '  ',
        outletUrl: 'https://nos.nl',
        standUrl: 'http://127.0.0.1/preview/1/index.html?t=secret',
      }),
    ).resolves.toBeNull();
    await expect(
      captureQaSurfaces({ chromePath: 'C:\\missing\\chrome.exe', outletUrl: 'https://evil.test', standUrl: null }),
    ).resolves.toBeNull();
  });

  it('carries the stand header crop when both outlet frames exist', () => {
    const header = Buffer.from('outlet-header');
    const footer = Buffer.from('outlet-footer');
    const landingHeader = Buffer.from('landing-header');
    const landingFooter = Buffer.from('landing-footer');
    expect(assembleOutletReference({ header, footer, landingHeader, landingFooter })).toEqual({
      header,
      footer,
      landingHeader,
      landingFooter,
    });
    expect(assembleOutletReference({ header: null, footer, landingHeader, landingFooter })).toBeNull();
    expect(assembleOutletReference({ header, footer: Buffer.alloc(0), landingHeader, landingFooter })).toBeNull();
  });

  it('clips a region in page coordinates, including content below the viewport', () => {
    expect(clipDocumentRegion({ x: 0, y: 7707, width: 2000, height: 4000 }, 1350)).toEqual({
      x: 0,
      y: 7707,
      width: 1350,
      height: 900,
    });
    expect(clipDocumentRegion({ x: 1400, y: 10, width: 100, height: 100 }, 1350)).toBeNull();
  });
});
