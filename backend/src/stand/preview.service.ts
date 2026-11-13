import fs from 'fs';
import path from 'path';
import { Inject, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppConfig } from '../config';
import { ACTIVE_CHECKS_REPO, APP_CONFIG, CHECK_ARCHIVES_REPO } from '../tokens';
import { CheckStore } from '../checks/check.store';
import { unpackZip } from '../files/unpack';
import { WorkdirService } from '../files/workdir.service';
import { resolveLandingFolder, safeResolveUnderLanding } from '../static/landing-utils';
import { CheckArchivesRepo, ActiveChecksRepo } from '../storage/repos';
import { resolveStandFormHtml } from './form-html';
import { applyCdnMacro, isolatedCsp, liveCsp, rewriteCssAssets, stampCdnUrls, transformHtml } from './transform';

const CDN_TEXT_EXT = new Set(['.css', '.js', '.mjs']);
const PREVIEW_COOKIE = 'qa_preview';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.php': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

@Injectable()
export class PreviewService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly checks: CheckStore,
    private readonly workdir: WorkdirService,
    @Inject(CHECK_ARCHIVES_REPO) private readonly archives: CheckArchivesRepo,
    @Inject(ACTIVE_CHECKS_REPO) private readonly active: ActiveChecksRepo,
  ) {}

  cdnBaseFor(checkId: string): string {
    if (this.config.standCdnBase) return this.config.standCdnBase.replace(/\/$/, '');
    return `${this.config.publicBaseUrl}/preview/${checkId}`;
  }

  standUrl(checkId: string, indexName: string, previewToken: string): string {
    const url = new URL(`${this.config.publicBaseUrl}/preview/${checkId}/${indexName}`);
    url.searchParams.set('t', previewToken);
    return url.toString();
  }

  async handle(req: Request, res: Response): Promise<void> {
    const pathname = new URL(req.originalUrl, 'http://localhost').pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] !== 'preview' || !parts[1]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const checkId = parts[1];
    const token = previewTokenFrom(req);
    const relative = parts.slice(2).join('/') || 'index.html';
    const local = this.checks.get(checkId);
    if (local) {
      if (!token || token !== local.previewToken || !local.standReady) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const folder = await this.folderFor(checkId, local.landingFolder);
      if (!folder) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      local.landingFolder = folder;
      this.send(res, req, checkId, folder, relative, local.actionsAllowed, local.card.countries, token);
      return;
    }
    const row = await this.active.get(checkId);
    if (!row || !token || token !== row.payload.previewToken || !row.payload.standReady) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const folder = await this.folderFor(checkId, null);
    if (!folder) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    this.send(res, req, checkId, folder, relative, row.payload.actionsAllowed, row.payload.countries ?? [], token);
  }

  private async folderFor(checkId: string, known: string | null): Promise<string | null> {
    if (known && fs.existsSync(known)) return known;
    const dir = this.workdir.directory(checkId);
    const ready = existingLanding(dir);
    if (ready) return ready;
    const zip = await this.archives.get(checkId);
    if (!zip) return null;
    try {
      return unpackZip(zip, dir).landingFolder;
    } catch {
      return null;
    }
  }

  private send(
    res: Response,
    req: Request,
    checkId: string,
    landingFolder: string,
    relative: string,
    actionsAllowed: boolean,
    countries: readonly string[],
    token: string,
  ): void {
    const target = path.resolve(landingFolder, relative);
    const root = path.resolve(landingFolder);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const policy = actionsAllowed ? liveCsp(this.config.frontendOrigin) : isolatedCsp(originOf(this.config.publicBaseUrl));
    const cdn = this.cdnBaseFor(checkId);
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'private');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('Set-Cookie', previewCookie(checkId, token, req.secure || this.config.publicBaseUrl.startsWith('https://')));
    const ext = path.extname(target).toLowerCase();
    res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    const assetExists = archivedAssetExists(landingFolder);
    if (ext === '.html' || ext === '.php') {
      const html = fs.readFileSync(target, 'utf8');
      res.send(
        transformHtml(html, {
          formHtml: resolveStandFormHtml(this.config.standFormHtml, countries),
          brandName: this.config.standBrandName,
          cdnBase: cdn,
          isolated: !actionsAllowed,
          previewToken: token,
          assetExists,
        }),
      );
      return;
    }
    if (CDN_TEXT_EXT.has(ext)) {
      let body = applyCdnMacro(fs.readFileSync(target, 'utf8'), cdn);
      if (ext === '.css') {
        body = rewriteCssAssets(body, {
          assetRoot: cdn,
          pageUrl: `${cdn.replace(/\/$/, '')}/${relative}`,
          previewToken: token,
          assetExists,
        });
      } else {
        body = stampCdnUrls(body, cdn, token);
      }
      res.send(body);
      return;
    }
    res.send(fs.readFileSync(target));
  }
}

function archivedAssetExists(landingFolder: string): (pathname: string) => boolean {
  const cache = new Map<string, boolean>();
  return (pathname) => {
    const cached = cache.get(pathname);
    if (cached !== undefined) return cached;
    const ok = landingFileExists(landingFolder, pathname);
    cache.set(pathname, ok);
    return ok;
  };
}

function landingFileExists(landingFolder: string, pathname: string): boolean {
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const relative = decoded.replace(/^\/+/, '');
  if (!relative) return false;
  const file = safeResolveUnderLanding(landingFolder, relative);
  if (!file) return false;
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function previewTokenFrom(req: Request): string {
  if (typeof req.query.t === 'string' && req.query.t) return req.query.t;
  return cookieValue(req.headers.cookie, PREVIEW_COOKIE);
}

function cookieValue(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function previewCookie(checkId: string, token: string, secure: boolean): string {
  const parts = [
    `${PREVIEW_COOKIE}=${encodeURIComponent(token)}`,
    `Path=/preview/${checkId}/`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=86400',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function existingLanding(dir: string): string | null {
  for (const candidate of [path.join(dir, 'project'), path.join(dir, 'raw')]) {
    if (!fs.existsSync(candidate)) continue;
    const resolved = resolveLandingFolder(candidate);
    if (resolved.ok && fs.existsSync(resolved.landingFolder)) return resolved.landingFolder;
  }
  return null;
}
