import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { APPLY_ROUTES } from '../core/apply-routes';
import { ROLE_QA, ROLE_TL } from '../core/models';
import { SessionStore } from '../core/session.store';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside class="nav" [attr.aria-label]="roleLabel()">
        <p class="brand">Помощник QA</p>
        <p class="role">{{ roleLabel() }}</p>
        <a routerLink="/launch" routerLinkActive="active">Запуск проверки</a>
        <a routerLink="/progress" [class.active]="progressActive()">Ход проверки</a>
        <a routerLink="/reports" routerLinkActive="active">Отчёты</a>
        <a routerLink="/stand" [class.active]="standActive()">Стенд</a>
        @if (session.role() === tl) {
          <a routerLink="/costs" routerLinkActive="active">Затраты</a>
          <a routerLink="/config" routerLinkActive="active">Конфиг</a>
          <a routerLink="/users" routerLinkActive="active">Пользователи</a>
          <a routerLink="/catalog-query" routerLinkActive="active">Каталог AIO</a>
        }
        <button type="button" class="secondary logout" (click)="logout()">Выйти</button>
      </aside>
      <main class="main">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ShellComponent {
  readonly session = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly applyRoutes = inject(APPLY_ROUTES);
  readonly tl = ROLE_TL;
  readonly qa = ROLE_QA;
  private readonly url = signal(this.router.url);

  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.url.set(this.router.url);
    });
  }

  roleLabel(): string {
    return this.session.role() === ROLE_TL ? 'Вы вошли как ТЛ' : 'Вы вошли как QA';
  }

  progressActive(): boolean {
    const url = this.url();
    return url.startsWith('/progress') || (url.startsWith('/checks/') && !url.includes('/stand'));
  }

  standActive(): boolean {
    const url = this.url();
    return url.startsWith('/stand') || url.includes('/stand');
  }

  logout(): void {
    this.api.logout().subscribe({
      next: () => this.finishLogout(),
      error: () => this.finishLogout(),
    });
  }

  private finishLogout(): void {
    this.session.clear();
    this.applyRoutes(null);
    void this.router.navigateByUrl('/login');
  }
}
