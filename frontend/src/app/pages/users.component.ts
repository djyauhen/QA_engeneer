import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../core/api.service';
import { inputValue } from '../core/format';
import { errorText } from '../core/http-error';
import { DUPLICATE_LOGIN, ENV_ACCOUNT, ROLE_QA, ROLE_TL, Role, UserRow } from '../core/models';

@Component({
  selector: 'app-users',
  template: `
    <h1>Пользователи</h1>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (loadError()) {
      <p class="alert error" role="alert">{{ loadError() }}</p>
    } @else if (users(); as list) {
      <div class="table-scroll">
      <table class="data" aria-label="Пользователи">
        <thead>
          <tr>
            <th>Логин</th>
            <th>Роль</th>
            <th>Источник</th>
          </tr>
        </thead>
        <tbody>
          @for (user of list; track user.login) {
            <tr>
              <td class="mono">{{ user.login }}</td>
              <td>{{ user.role }}</td>
              <td>
                @if (user.source === 'environment') {
                  <span class="chip">{{ envLabel }}</span>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      </div>
      <form class="card user-form" (submit)="create($event)">
        <label for="new-login">Логин</label>
        <input id="new-login" autocomplete="off" [value]="login()" (input)="login.set(inputValue($event))" />
        <label for="new-password">Пароль</label>
        <input
          id="new-password"
          type="password"
          autocomplete="new-password"
          [value]="password()"
          (input)="password.set(inputValue($event))"
        />
        <fieldset>
          <legend>Роль</legend>
          <label class="choice" [class.selected]="role() === tl">
            <input type="radio" name="role" [checked]="role() === tl" (change)="role.set(tl)" />
            ТЛ
          </label>
          <label class="choice" [class.selected]="role() === qa">
            <input type="radio" name="role" [checked]="role() === qa" (change)="role.set(qa)" />
            QA
          </label>
        </fieldset>
        @if (createError()) {
          <p class="alert error" role="alert">{{ createError() }}</p>
        }
        <button type="submit" class="primary" [disabled]="creating()">Создать</button>
      </form>
    }
  `,
})
export class UsersComponent {
  private readonly api = inject(ApiService);
  readonly users = signal<UserRow[] | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly createError = signal('');
  readonly creating = signal(false);
  readonly login = signal('');
  readonly password = signal('');
  readonly role = signal<Role>(ROLE_QA);
  readonly tl = ROLE_TL;
  readonly qa = ROLE_QA;
  readonly envLabel = ENV_ACCOUNT;
  readonly inputValue = inputValue;

  constructor() {
    this.reload();
  }

  create(event: Event): void {
    event.preventDefault();
    const login = this.login().trim();
    const password = this.password();
    const role = this.role();
    this.createError.set('');
    if (!login && !password) {
      this.createError.set('Введите логин и пароль.');
      return;
    }
    if (!login) {
      this.createError.set('Введите логин.');
      return;
    }
    if (!password) {
      this.createError.set('Введите пароль.');
      return;
    }
    this.creating.set(true);
    this.api.createUser({ login, password, role }).subscribe({
      next: () => {
        this.password.set('');
        this.login.set('');
        this.creating.set(false);
        this.reload();
      },
      error: (error: unknown) => {
        this.password.set('');
        this.creating.set(false);
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.createError.set(DUPLICATE_LOGIN);
          return;
        }
        this.createError.set(errorText(error, 'Не удалось создать пользователя.'));
      },
    });
  }

  private reload(): void {
    this.api.users().subscribe({
      next: (response) => {
        this.users.set(response.users ?? []);
        this.loading.set(false);
        this.loadError.set('');
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.users.set(null);
        this.loadError.set(errorText(error, 'Не удалось загрузить пользователей.'));
      },
    });
  }
}
