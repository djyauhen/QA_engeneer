import type { Browser, Page } from 'puppeteer-core';
import { isAllowedOutletUrl } from './outlets';

const VIEWPORT = { width: 1350, height: 940 };
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADER_SELECTORS = ['header', '[role="banner"]', 'nav[aria-label]', 'nav'];
const FOOTER_SELECTORS = ['footer', '[role="contentinfo"]'];
const CONSENT_LABELS = [
  'Akkoord',
  'Accepteren',
  'Alles accepteren',
  'Accept all',
  'Accept',
  'Agree',
  'I agree',
  'Alle akzeptieren',
  'Akzeptieren',
  'Tout accepter',
  'Aceptar',
  'Accetta',
  'Godta',
  'Tillad alle',
  'Acceptera',
];

export interface OutletReferenceShots {
  header: Buffer;
  footer: Buffer;
  landingFooter: Buffer | null;
}

/** Document coordinates. Puppeteer clip with captureBeyondViewport is measured from the top of the page, not the scrolled viewport. */
export function clipDocumentRegion(
  box: { x: number; y: number; width: number; height: number },
  maxWidth: number,
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  if (x >= maxWidth) return null;
  const width = Math.min(Math.round(box.width), maxWidth - x);
  const height = Math.min(Math.round(box.height), 900);
  if (width < 40 || height < 24) return null;
  return { x, y, width, height };
}

export async function captureOutletReference(options: {
  chromePath: string;
  outletUrl: string;
  standUrl: string | null;
}): Promise<OutletReferenceShots | null> {
  const executablePath = options.chromePath.trim();
  if (!executablePath || !isAllowedOutletUrl(options.outletUrl)) return null;
  let browser: Browser | null = null;
  try {
    const loaded = await import('puppeteer-core');
    const puppeteer = loaded.default ?? loaded;
    browser = await puppeteer.launch({ executablePath, headless: true, timeout: 15000 });
    const headerPage = await openPage(browser, options.outletUrl);
    const header = await shootRegion(headerPage, HEADER_SELECTORS, 'top');
    const footer = await shootRegion(headerPage, FOOTER_SELECTORS, 'bottom');
    await headerPage.close().catch(() => undefined);
    if (!header || !footer) return null;
    let landingFooter: Buffer | null = null;
    if (options.standUrl) {
      const stand = await openPage(browser, options.standUrl);
      landingFooter = await shootRegion(stand, FOOTER_SELECTORS, 'bottom');
      await stand.close().catch(() => undefined);
    }
    return { header, footer, landingFooter };
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function openPage(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(USER_AGENT);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await dismissConsent(page);
  return page;
}

async function dismissConsent(page: Page): Promise<void> {
  try {
    const clicked = await page.evaluate((words: string[]) => {
      const wanted = new Set(words.map((word) => word.toLowerCase()));
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const button of buttons) {
        const text = (button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!wanted.has(text)) continue;
        const container = button.closest('[id*="consent"], [class*="consent"], [id*="cookie"], [class*="cookie"], [id*="privacy"]');
        if (!container && text.length < 6) continue;
        (button as HTMLElement).click();
        return true;
      }
      return false;
    }, CONSENT_LABELS);
    if (clicked) await new Promise((resolve) => setTimeout(resolve, 300));
  } catch {
    // A missing banner is not a failed capture.
  }
}

async function shootRegion(page: Page, selectors: string[], fallback: 'top' | 'bottom'): Promise<Buffer | null> {
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (!handle) continue;
    try {
      const box = await handle.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
        };
      });
      const clip = clipDocumentRegion(box, VIEWPORT.width);
      if (!clip) continue;
      const shot = await page.screenshot({ type: 'jpeg', quality: 60, clip, captureBeyondViewport: true });
      return Buffer.from(shot);
    } catch {
      continue;
    } finally {
      await handle.dispose().catch(() => undefined);
    }
  }
  try {
    const doc = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
    }));
    const height = Math.min(VIEWPORT.height, Math.max(24, Math.round(doc.height)));
    const clip = {
      x: 0,
      y: fallback === 'bottom' ? Math.max(0, Math.round(doc.height - height)) : 0,
      width: Math.min(VIEWPORT.width, Math.max(40, Math.round(doc.width))),
      height,
    };
    const shot = await page.screenshot({ type: 'jpeg', quality: 60, clip, captureBeyondViewport: true });
    return Buffer.from(shot);
  } catch {
    return null;
  }
}
