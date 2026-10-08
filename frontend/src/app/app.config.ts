import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { buildRoutes, routes } from './app.routes';
import { APPLY_ROUTES } from './core/apply-routes';
import { ApiService } from './core/api.service';
import { sessionInterceptor } from './core/session.interceptor';
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
        .catch(() => {
          store.clear();
          apply(null);
        });
    }),
  ],
};
