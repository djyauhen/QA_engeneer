import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ROLE_TL } from './models';
import { SessionStore } from './session.store';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  if (session.role()) return true;
  return router.createUrlTree(['/login']);
};

export const tlGuard: CanActivateFn = () => {
  const session = inject(SessionStore);
  const router = inject(Router);
  if (session.role() === ROLE_TL) return true;
  return router.createUrlTree(['/launch']);
};
