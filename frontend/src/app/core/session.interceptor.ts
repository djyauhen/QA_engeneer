import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { ROLE_QA, ACCESS_DENIED } from './models';
import { SessionStore } from './session.store';

export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionStore);
  if (session.role() === ROLE_QA && req.url.includes('/admin/')) {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 403,
          statusText: 'Forbidden',
          url: req.url,
          error: { error: 'forbidden', message: ACCESS_DENIED },
        }),
    );
  }
  const sessionId = session.sessionId();
  const headers = sessionId ? req.headers.set('X-Session-Id', sessionId) : req.headers;
  return next(req.clone({ headers, withCredentials: true }));
};
