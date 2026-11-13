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
      <table class="data users" aria-label="Пользователи">
        <thead>
          <tr>
            <th class="col-login">Логин</th>
            <th class="col-role">Роль</th>
            <th>Источник</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          @for (user of list; track user.login) {
            <tr>
              <td class="mono col-login">{{ user.login }}</td>
              <td class="col-role">{{ user.role }}</td>
              <td>
                @if (user.source === 'environment') {
                  <span class="chip">{{ envLabel }}</span>
                } @else if (user.disabled) {
                  <span class="chip">Заблокирован</span>
                }
              </td>
              <td>
                @if (user.source !== 'environment') {
                  <div class="user-actions">
                    <button
                      type="button"
                      class="quiet"
                      [disabled]="busy() === user.login"
                      (click)="toggleBlock(user)"
                    >
                      {{ user.disabled ? 'Разблокировать' : 'Заблокировать' }}
                    </button>
                    <form class="user-actions" (submit)="changePassword($event, user.login)">
                      <label class="visually-hidden" [attr.for]="'pw-' + user.login">Новый пароль для {{ user.login }}</label>
                      <input
                        [id]="'pw-' + user.login"
                        type="password"
                        autocomplete="new-password"
                        [value]="draft(user.login)"
                        (input)="setDraft(user.login, inputValue($event))"
                      />
                      <button type="submit" class="quiet" [disabled]="busy() === user.login">Сменить пароль</button>
                    </form>
                  </div>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
      </div>
      <form class="card user-form" (submit)="create($event)">
        <div class="field">
          <label for="new-login">Логин</label>
          <input id="new-login" autocomplete="off" [value]="login()" (input)="login.set(inputValue($event))" />
        </div>
        <div class="field">
          <label for="new-password">Пароль</label>
          <input
            id="new-password"
            type="password"
            autocomplete="new-password"
            [value]="password()"
            (input)="password.set(inputValue($event))"
          />
        </div>
        <fieldset>
          <legend>Роль</legend>
          <div class="choices">
            <label class="choice" [class.selected]="role() === tl">
              <input type="radio" name="role" [checked]="role() === tl" (change)="role.set(tl)" />
              ТЛ
            </label>
            <label class="choice" [class.selected]="role() === qa">
              <input type="radio" name="role" [checked]="role() === qa" (change)="role.set(qa)" />
              QA
            </label>
          </div>
        </fieldset>
        @if (createError()) {
          <p class="alert error" role="alert">{{ createError() }}</p>
        }
        <button type="submit" class="primary" [disabled]="creating()">Создать</button>
      </form>
      @if (actionError()) {
        <p class="alert error" role="alert">{{ actionError() }}</p>
      }
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
  readonly busy = signal('');
  readonly actionError = signal('');
  private readonly drafts = signal<Record<string, string>>({});

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

  draft(login: string): string {
    return this.drafts()[login] ?? '';
  }

  setDraft(login: string, value: string): void {
    this.drafts.update((current) => ({ ...current, [login]: value }));
  }

  toggleBlock(user: UserRow): void {
    if (this.busy()) return;
    this.actionError.set('');
    this.busy.set(user.login);
    this.api.setUserBlocked(user.login, !user.disabled).subscribe({
      next: () => {
        this.busy.set('');
        this.reload();
      },
      error: (error: unknown) => {
        this.busy.set('');
        this.actionError.set(errorText(error, 'Не удалось изменить блокировку.'));
      },
    });
  }

  changePassword(event: Event, login: string): void {
    event.preventDefault();
    const password = this.draft(login);
    this.actionError.set('');
    if (password.length < 8) {
      this.actionError.set('Пароль должен быть не короче 8 символов.');
      return;
    }
    if (this.busy()) return;
    this.busy.set(login);
    this.api.setUserPassword(login, password).subscribe({
      next: () => {
        this.busy.set('');
        this.setDraft(login, '');
        this.reload();
      },
      error: (error: unknown) => {
        this.busy.set('');
        this.setDraft(login, '');
        this.actionError.set(errorText(error, 'Не удалось сменить пароль.'));
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
