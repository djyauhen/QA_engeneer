import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { APPLY_ROUTES } from '../core/apply-routes';
import { inputValue } from '../core/format';
import { LOGIN_ERROR } from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-login',
  template: `
    <main class="login-screen">
      <form class="card login-card" (submit)="submit($event)">
        <h1>Вход</h1>
        <label for="login">Логин</label>
        <input id="login" name="login" autocomplete="username" [value]="login()" (input)="login.set(inputValue($event))" />
        <label for="password">Пароль</label>
        <input
          id="password"
          name="password"
          type="password"
          autocomplete="current-password"
          [value]="password()"
          (input)="password.set(inputValue($event))"
        />
        @if (error()) {
          <p class="alert error" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="primary" [disabled]="busy()">Войти</button>
      </form>
    </main>
  `,
})
export class LoginComponent {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly applyRoutes = inject(APPLY_ROUTES);
  readonly login = signal('');
  readonly password = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly inputValue = inputValue;

  submit(event: Event): void {
    event.preventDefault();
    this.error.set('');
    const login = this.login();
    const password = this.password();
    if (!login || !password) {
      this.error.set(LOGIN_ERROR);
      return;
    }
    this.busy.set(true);
    this.api.login(login, password).subscribe({
      next: (response) => {
        this.password.set('');
        this.session.establish(response.session_id, response.role, login);
        this.applyRoutes(response.role);
        void this.router.navigateByUrl('/launch');
      },
      error: (error: unknown) => {
        this.password.set('');
        this.busy.set(false);
        if (error instanceof HttpErrorResponse && (error.status === 400 || error.status === 401)) {
          this.error.set(LOGIN_ERROR);
          return;
        }
        this.error.set('Не удалось выполнить запрос.');
      },
    });
  }
}
