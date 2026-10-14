import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subject, Subscription } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { STAND_BEFORE_ACTIONS, STAND_URL_CAPTION, CheckView } from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-stand',
  template: `
    <h1>Стенд</h1>
    @if (!checkId()) {
      <p class="empty">Нет текущей проверки.</p>
    } @else if (loading() && !loaded()) {
      <p>Загрузка…</p>
    } @else if (error() && !loaded()) {
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else {
      @if (error()) {
        <p class="alert error" role="alert">{{ error() }}</p>
      }
      @if (standUrl()) {
        <p class="hint">{{ caption }}</p>
        <p><a [href]="standUrl()" target="_blank" rel="noopener noreferrer">{{ standUrl() }}</a></p>
        @if (frame(); as src) {
          <iframe
            class="stand-frame"
            [src]="src"
            title="Просмотр стенда"
            referrerpolicy="no-referrer"
            [attr.sandbox]="sandbox()"
          ></iframe>
        }
        @if (!actionsAllowed()) {
          <p>{{ beforeActions }}</p>
          <button type="button" class="primary" (click)="allow()" [disabled]="sending()">Разрешить действия ленда</button>
        }
      } @else {
        <p class="empty">Стенд ещё не готов</p>
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
  private readonly frameVersion = signal(0);
  readonly frame = computed(() => {
    const url = this.standUrl();
    if (!/^https?:\/\//i.test(url)) return null;
    const version = this.frameVersion();
    const src = version > 0 ? withActionsParam(url, version) : url;
    return this.sanitizer.bypassSecurityTrustResourceUrl(src);
  });
  readonly checkId = signal('');
  readonly standUrl = signal('');
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly sending = signal(false);
  readonly actionsAllowed = signal(false);
  readonly caption = STAND_URL_CAPTION;
  readonly beforeActions = STAND_BEFORE_ACTIONS;
  private timer = 0;
  private pollSub: Subscription | null = null;
  private generation = 0;

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
        this.stopPoll();
        return;
      }
      this.open(id);
    });
    this.destroyRef.onDestroy(() => this.stopPoll());
  }

  sandbox(): string {
    return this.actionsAllowed() ? 'allow-forms allow-scripts' : '';
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
        this.frameVersion.update((version) => version + 1);
      },
      error: (error: unknown) => {
        this.sending.set(false);
        this.actionError.set(errorText(error, 'Сервер отказал в разрешении действий.'));
      },
    });
  }

  private open(id: string): void {
    this.stopPoll();
    this.checkId.set(id);
    this.session.rememberCheck(id);
    this.loading.set(true);
    this.loaded.set(false);
    this.error.set('');
    this.actionError.set('');
    this.standUrl.set('');
    this.actionsAllowed.set(false);
    this.frameVersion.set(0);
    this.poll();
  }

  private poll(): void {
    this.stopPoll();
    const id = this.checkId();
    if (!id) return;
    const generation = ++this.generation;
    const ticks = new Subject<void>();
    this.pollSub = ticks
      .pipe(
        switchMap(() =>
          this.api.check(id).pipe(
            catchError((error: unknown) => {
              if (generation === this.generation) this.onPollError(id, error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe((view) => {
        if (generation !== this.generation || this.checkId() !== id) return;
        this.applyView(view);
        if (!standStillPending(view)) this.stopTimer();
      });
    const kick = () => {
      if (generation !== this.generation) return;
      ticks.next();
    };
    kick();
    this.timer = window.setInterval(kick, 1500);
  }

  private applyView(view: CheckView): void {
    this.loading.set(false);
    this.loaded.set(true);
    this.error.set('');
    this.standUrl.set(typeof view.stand_url === 'string' ? view.stand_url : '');
    if (view.actions_allowed) this.actionsAllowed.set(true);
  }

  private onPollError(id: string, error: unknown): void {
    if (this.checkId() !== id) return;
    this.loading.set(false);
    this.error.set(errorText(error, 'Не удалось открыть стенд.'));
    if ((error instanceof HttpErrorResponse && error.status === 401) || !this.loaded()) this.stopTimer();
  }

  private stopTimer(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private stopPoll(): void {
    this.stopTimer();
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }
}

function standStillPending(view: CheckView): boolean {
  if (typeof view.stand_url === 'string' && view.stand_url.length > 0) return false;
  const stand = view.steps.find((step) => step.name === 'stand');
  if (!stand) return true;
  return stand.state === 'pending' || stand.state === 'running' || stand.state === 'retrying' || stand.state === 'waiting_user';
}

function withActionsParam(url: string, version: number): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const join = base.includes('?') ? '&' : '?';
  return `${base}${join}actions=${version}${hash}`;
}
