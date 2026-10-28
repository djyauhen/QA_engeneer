import fs from 'fs';
import path from 'path';
import { Inject, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppConfig } from '../config';
import { ACTIVE_CHECKS_REPO, APP_CONFIG, CHECK_ARCHIVES_REPO } from '../tokens';
import { CheckStore } from '../checks/check.store';
import { unpackZip } from '../files/unpack';
import { WorkdirService } from '../files/workdir.service';
import { resolveLandingFolder } from '../static/landing-utils';
import { CheckArchivesRepo, ActiveChecksRepo } from '../storage/repos';
import { resolveStandFormHtml } from './form-html';
import { applyCdnMacro, ISOLATED_CSP, liveCsp, transformHtml } from './transform';

const CDN_TEXT_EXT = new Set(['.css', '.js', '.mjs']);

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
    const token = typeof req.query.t === 'string' ? req.query.t : '';
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
      this.send(res, checkId, folder, relative, local.actionsAllowed, local.card.countries);
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
    this.send(res, checkId, folder, relative, row.payload.actionsAllowed, row.payload.countries ?? []);
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
    checkId: string,
    landingFolder: string,
    relative: string,
    actionsAllowed: boolean,
    countries: readonly string[],
  ): void {
    const target = path.resolve(landingFolder, relative);
    const root = path.resolve(landingFolder);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const policy = actionsAllowed ? liveCsp(this.config.frontendOrigin) : ISOLATED_CSP;
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const ext = path.extname(target).toLowerCase();
    res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    if (ext === '.html' || ext === '.php') {
      const html = fs.readFileSync(target, 'utf8');
      res.send(
        transformHtml(html, {
          formHtml: resolveStandFormHtml(this.config.standFormHtml, countries),
          brandName: this.config.standBrandName,
          cdnBase: this.cdnBaseFor(checkId),
          isolated: !actionsAllowed,
        }),
      );
      return;
    }
    if (CDN_TEXT_EXT.has(ext)) {
      res.send(applyCdnMacro(fs.readFileSync(target, 'utf8'), this.cdnBaseFor(checkId)));
      return;
    }
    res.send(fs.readFileSync(target));
  }
}

function existingLanding(dir: string): string | null {
  for (const candidate of [path.join(dir, 'project'), path.join(dir, 'raw')]) {
    if (!fs.existsSync(candidate)) continue;
    const resolved = resolveLandingFolder(candidate);
    if (resolved.ok && fs.existsSync(resolved.landingFolder)) return resolved.landingFolder;
  }
  return null;
}
