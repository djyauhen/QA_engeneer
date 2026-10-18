export const DESKTOP_SHOT = 'desktop';

export function wantsVisualCapture(mode: 'stub' | 'real', standUrl: string | null): boolean {
  return mode === 'real' && !!standUrl;
}

export async function captureStandJpeg(url: string, chromePath: string): Promise<Buffer> {
  const executablePath = chromePath.trim();
  if (!executablePath) throw new Error('no-chrome');
  const loaded = await import('puppeteer-core');
  const puppeteer = loaded.default ?? loaded;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1350, height: 940 });
    await page.goto(url);
    const shot = await page.screenshot({ type: 'jpeg', quality: 60 });
    return Buffer.from(shot);
  } finally {
    await browser.close();
  }
}
