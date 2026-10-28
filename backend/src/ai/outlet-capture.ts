import type { Browser, Page } from 'puppeteer-core';
import { previewSliceOffsets } from '../stand/preview-slices';
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

const SETTLE_MS = 500;

export async function captureOutletReference(options: {
  chromePath: string;
  outletUrl: string;
  standUrl: string | null;
}): Promise<OutletReferenceShots | null> {
  const executablePath = options.chromePath.trim();
  if (!executablePath || !isAllowedOutletUrl(options.outletUrl)) return null;
  const captured = await captureQaSurfaces({
    chromePath: executablePath,
    outletUrl: options.outletUrl,
    standUrl: options.standUrl,
  });
  return captured?.outlet ?? null;
}

/** One browser session: outlet header/footer when the URL is allowlisted, and the stand's visible text. Retries once. */
export async function captureQaSurfaces(options: {
  chromePath: string;
  outletUrl: string | null;
  standUrl: string | null;
}): Promise<{ outlet: OutletReferenceShots | null; pageText: string } | null> {
  const executablePath = options.chromePath.trim();
  if (!executablePath) return null;
  const outletUrl = options.outletUrl && isAllowedOutletUrl(options.outletUrl) ? options.outletUrl : null;
  const standUrl = options.standUrl?.trim() ? options.standUrl.trim() : null;
  if (!outletUrl && !standUrl) return null;
  const wantOutlet = !!outletUrl;
  const wantText = !!standUrl;
  let result = await captureOnce(executablePath, outletUrl, standUrl);
  if (!surfacesReady(result, wantOutlet, wantText)) {
    const second = await captureOnce(executablePath, outletUrl, standUrl);
    result = {
      outlet: second.outlet ?? result.outlet,
      pageText: second.pageText.trim() ? second.pageText : result.pageText,
    };
  }
  return result;
}

export interface PreviewPageCapture {
  pageText: string;
  shots: Buffer[];
}

/** Opens the AIO preview URL in Chrome and returns its visible text plus viewport JPEGs from top to bottom. */
export async function capturePreviewPage(url: string, chromePath: string): Promise<PreviewPageCapture> {
  const executablePath = chromePath.trim();
  const target = url.trim();
  if (!executablePath || !target) return { pageText: '', shots: [] };
  let result = await capturePreviewOnce(executablePath, target);
  if (!result.pageText.trim() && result.shots.length === 0) {
    const second = await capturePreviewOnce(executablePath, target);
    if (second.pageText.trim() || second.shots.length > 0) result = second;
  }
  return result;
}

async function capturePreviewOnce(executablePath: string, url: string): Promise<PreviewPageCapture> {
  let browser: Browser | null = null;
  try {
    const loaded = await import('puppeteer-core');
    const puppeteer = loaded.default ?? loaded;
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      timeout: 15000,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = await openPage(browser, url, true);
    try {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => undefined);
      const text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      const pageText = typeof text === 'string' ? text : '';
      const doc = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
      }));
      const scrollHeight = Math.max(VIEWPORT.height, Math.round(doc.height) || 0);
      const offsets = previewSliceOffsets(scrollHeight, VIEWPORT.height);
      const shots: Buffer[] = [];
      for (const y of offsets) {
        const height = Math.min(VIEWPORT.height, Math.max(24, scrollHeight - y));
        const shot = await page.screenshot({
          type: 'jpeg',
          quality: 60,
          clip: { x: 0, y, width: VIEWPORT.width, height },
          captureBeyondViewport: true,
        });
        shots.push(Buffer.from(shot));
      }
      return { pageText, shots };
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch {
    return { pageText: '', shots: [] };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function captureOnce(
  executablePath: string,
  outletUrl: string | null,
  standUrl: string | null,
): Promise<{ outlet: OutletReferenceShots | null; pageText: string }> {
  let browser: Browser | null = null;
  try {
    const loaded = await import('puppeteer-core');
    const puppeteer = loaded.default ?? loaded;
    browser = await puppeteer.launch({ executablePath, headless: true, timeout: 15000 });
    let header: Buffer | null = null;
    let footer: Buffer | null = null;
    let landingFooter: Buffer | null = null;
    let pageText = '';
    if (outletUrl) {
      const headerPage = await openPage(browser, outletUrl, true);
      try {
        header = await shootRegion(headerPage, HEADER_SELECTORS, 'top');
        footer = await shootRegion(headerPage, FOOTER_SELECTORS, 'bottom');
      } finally {
        await headerPage.close().catch(() => undefined);
      }
    }
    if (standUrl) {
      const stand = await openPage(browser, standUrl, false);
      try {
        const text = await stand.evaluate(() => (document.body ? document.body.innerText : ''));
        pageText = typeof text === 'string' ? text : '';
        landingFooter = await shootRegion(stand, FOOTER_SELECTORS, 'bottom');
      } finally {
        await stand.close().catch(() => undefined);
      }
    }
    const outlet = header && footer ? { header, footer, landingFooter } : null;
    return { outlet, pageText };
  } catch {
    return { outlet: null, pageText: '' };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function surfacesReady(
  result: { outlet: OutletReferenceShots | null; pageText: string },
  wantOutlet: boolean,
  wantText: boolean,
): boolean {
  if (wantOutlet && !result.outlet) return false;
  if (wantText && !result.pageText.trim()) return false;
  return true;
}

async function openPage(browser: Browser, url: string, dismiss: boolean): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(USER_AGENT);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  if (dismiss) await dismissConsent(page);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
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
