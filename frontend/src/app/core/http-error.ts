import { HttpErrorResponse } from '@angular/common/http';
import { ACCESS_DENIED } from './models';
import { scrubSignedUrls } from './format';

export function errorCode(error: unknown): string {
  const body = errorBody(error);
  return typeof body?.['error'] === 'string' ? body['error'] : '';
}

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
    const code = errorCode(error);
    if (error.status === 403 || code === 'forbidden') return ACCESS_DENIED;
  }
  const body = errorBody(error);
  const message = typeof body?.['message'] === 'string' ? body['message'] : '';
  const code = typeof body?.['error'] === 'string' ? body['error'] : '';
  const raw = message || (code && code !== 'forbidden' ? code : '') || fallback;
  return scrubSignedUrls(raw);
}

function errorBody(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== 'object') return null;
  return error.error as Record<string, unknown>;
}
