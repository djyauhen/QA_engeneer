import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { APPLY_ROUTES } from './apply-routes';
import { ACCESS_DENIED, ROLE_QA } from './models';
import { SessionStore } from './session.store';

export const sessionInterceptor: HttpInterceptorFn = (req, next) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const applyRoutes = inject(APPLY_ROUTES);
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
  return next(req.clone({ headers, withCredentials: true })).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isSessionLogin(req.method, req.url)) {
        session.clear();
        applyRoutes(null);
        const path = router.url.split(/[?#]/)[0];
        if (path !== '/login') void router.navigateByUrl('/login');
      }
      return throwError(() => error);
    }),
  );
};

function isSessionLogin(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const path = url.split(/[?#]/)[0];
  return /\/session$/.test(path);
}
