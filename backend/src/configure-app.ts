import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AppConfig } from './config';
import { RedactingFilter } from './http.filter';
import { PreviewService } from './stand/preview.service';
import { APP_CONFIG } from './tokens';

export function corsOrigin(frontendOrigin: string[]): string[] | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void) {
  if (frontendOrigin.length > 0) return [...new Set(frontendOrigin)];
  return (origin, callback) => {
    callback(null, !origin || isLoopbackOrigin(origin));
  };
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** Trust X-Forwarded-Proto only when the peer is loopback (nginx on this host). */
export function trustLoopbackProxy(app: INestApplication): void {
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
}

export function configureApp(app: INestApplication): void {
  trustLoopbackProxy(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  app.useGlobalFilters(new RedactingFilter(config));
  app.enableCors({
    origin: corsOrigin(config.frontendOrigin),
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Session-Id', 'Authorization'],
  });
  const preview = app.get(PreviewService);
  app.use('/preview', (req: Request, res: Response, next: NextFunction) => {
    void preview.handle(req, res).catch(next);
  });
}
