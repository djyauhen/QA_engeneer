import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { STAND_BEFORE_ACTIONS, STAND_URL_CAPTION } from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-stand',
  template: `
    <h1>Стенд</h1>
    @if (!checkId()) {
      <p class="empty">Нет текущей проверки.</p>
    } @else if (loading()) {
      <p>Загрузка…</p>
    } @else if (error()) {
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else {
      @if (standUrl()) {
        <p class="hint">{{ caption }}</p>
        <p><a [href]="standUrl()" target="_blank" rel="noopener noreferrer">{{ standUrl() }}</a></p>
        @if (frame(); as src) {
          <iframe class="stand-frame" [src]="src" title="Просмотр стенда" referrerpolicy="no-referrer"></iframe>
        }
        @if (!actionsAllowed()) {
          <p>{{ beforeActions }}</p>
          <button type="button" class="primary" (click)="allow()" [disabled]="sending()">Разрешить действия ленда</button>
        }
      } @else {
        <div class="card stand-empty"></div>
      }
      @if (actionError()) {
        <p class="alert error" role="alert">{{ actionError() }}</p>
      }
    }
  `,
})
export class StandComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  readonly frame = computed(() => {
    const url = this.standUrl();
    if (!/^https?:\/\//i.test(url)) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });
  readonly checkId = signal('');
  readonly standUrl = signal('');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly sending = signal(false);
  readonly actionsAllowed = signal(false);
  readonly caption = STAND_URL_CAPTION;
  readonly beforeActions = STAND_BEFORE_ACTIONS;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('checkId') ?? '';
      if (!id) {
        const remembered = this.session.lastCheckId();
        if (remembered) {
          void this.router.navigate(['/checks', remembered, 'stand']);
          return;
        }
        this.checkId.set('');
        return;
      }
      this.open(id);
    });
  }

  allow(): void {
    const id = this.checkId();
    if (!id || this.sending() || this.actionsAllowed()) return;
    this.sending.set(true);
    this.actionError.set('');
    this.api.standActions(id).subscribe({
      next: () => {
        this.sending.set(false);
        this.actionsAllowed.set(true);
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.actionError.set(errorText(error, 'Сервер отказал в разрешении действий.'));
      },
    });
  }

  private open(id: string): void {
    this.checkId.set(id);
    this.session.rememberCheck(id);
    this.loading.set(true);
    this.error.set('');
    this.standUrl.set('');
    this.actionsAllowed.set(false);
    this.api.check(id).subscribe({
      next: (view) => {
        this.loading.set(false);
        this.standUrl.set(typeof view.stand_url === 'string' ? view.stand_url : '');
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(errorText(error, 'Не удалось открыть стенд.'));
      },
    });
  }
}
