import fs from 'fs';
import path from 'path';
import { Inject, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppConfig } from '../config';
import { APP_CONFIG } from '../tokens';
import { CheckStore } from '../checks/check.store';
import { ISOLATED_CSP, transformHtml } from './transform';

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
  ) {}

  cdnBaseFor(checkId: string): string {
    if (this.config.standCdnBase) return this.config.standCdnBase.replace(/\/$/, '');
    return `${this.config.publicBaseUrl}/preview/${checkId}`;
  }

  standUrl(checkId: string, indexName: string): string {
    return `${this.config.publicBaseUrl}/preview/${checkId}/${indexName}`;
  }

  async handle(req: Request, res: Response): Promise<void> {
    const pathname = new URL(req.originalUrl, 'http://localhost').pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] !== 'preview' || !parts[1]) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const check = this.checks.get(parts[1]);
    if (!check || !check.standReady || !check.landingFolder) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const relative = parts.slice(2).join('/') || 'index.html';
    const target = path.resolve(check.landingFolder, relative);
    const root = path.resolve(check.landingFolder);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!check.actionsAllowed) res.setHeader('Content-Security-Policy', ISOLATED_CSP);
    const ext = path.extname(target).toLowerCase();
    res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
    if (ext === '.html' || ext === '.php') {
      const html = fs.readFileSync(target, 'utf8');
      res.send(
        transformHtml(html, {
          formHtml: this.config.standFormHtml,
          brandName: this.config.standBrandName,
          cdnBase: this.cdnBaseFor(check.id),
          isolated: !check.actionsAllowed,
        }),
      );
      return;
    }
    res.send(fs.readFileSync(target));
  }
}
