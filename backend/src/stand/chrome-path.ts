import fs from 'fs';
import path from 'path';

/**
 * Configured VISUAL_CHROME_PATH / LIGHTHOUSE_CHROME_PATH wins.
 * An empty path is resolved from common Windows Chrome and Edge locations.
 * Empty after that means capture is skipped.
 */
export function resolveChromeExecutable(
  configured: string,
  exists: (candidate: string) => boolean = chromeFileExists,
): string {
  const trimmed = configured.trim();
  if (trimmed) return trimmed;
  if (process.platform !== 'win32') return '';
  for (const candidate of windowsBrowsers()) {
    if (exists(candidate)) return candidate;
  }
  return '';
}

function windowsBrowsers(): string[] {
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const paths = [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    local ? path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
  ];
  return paths.filter((candidate) => candidate.length > 0);
}

function chromeFileExists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
