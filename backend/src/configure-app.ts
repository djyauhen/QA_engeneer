import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AppConfig } from './config';
import { RedactingFilter } from './http.filter';
import { PreviewService } from './stand/preview.service';
import { APP_CONFIG } from './tokens';

const DEPLOYED_FRONTEND_ORIGIN = 'https://qa-engeneer.vercel.app';

export function corsOrigin(frontendOrigin: string[]): true | string[] {
  if (frontendOrigin.length === 0) return true;
  return [...new Set([...frontendOrigin, DEPLOYED_FRONTEND_ORIGIN])];
}

export function configureApp(app: INestApplication): void {
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
