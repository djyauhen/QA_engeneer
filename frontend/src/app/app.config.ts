import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { buildRoutes, routes } from './app.routes';
import { APPLY_ROUTES } from './core/apply-routes';
import { ApiService } from './core/api.service';
import { sessionInterceptor } from './core/session.interceptor';
import { shouldClearSession } from './core/format';
import { Role } from './core/models';
import { SessionStore } from './core/session.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideHttpClient(withInterceptors([sessionInterceptor])),
    provideRouter(routes),
    {
      provide: APPLY_ROUTES,
      useFactory: () => {
        const router = inject(Router);
        return (role: Role | null) => router.resetConfig(buildRoutes(role));
      },
    },
    provideAppInitializer(() => {
      const api = inject(ApiService);
      const store = inject(SessionStore);
      const apply = inject(APPLY_ROUTES);
      return firstValueFrom(api.currentSession())
        .then((response) => {
          store.setRole(response.role);
          apply(response.role);
        })
        .catch((error: unknown) => {
          const status = error instanceof HttpErrorResponse ? error.status : undefined;
          if (!shouldClearSession(status)) return;
          store.clear();
          apply(null);
        });
    }),
  ],
};
