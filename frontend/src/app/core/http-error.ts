import { HttpErrorResponse } from '@angular/common/http';

export { errorText } from './format';

export function errorCode(error: unknown): string {
  const body = errorBody(error);
  return typeof body?.['error'] === 'string' ? body['error'] : '';
}

function errorBody(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof HttpErrorResponse) || !error.error || typeof error.error !== 'object') return null;
  return error.error as Record<string, unknown>;
}
