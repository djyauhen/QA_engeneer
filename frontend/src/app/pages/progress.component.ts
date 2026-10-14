import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Subject, Subscription } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { shouldPoll } from '../core/format';
import {
  AI_GATE_TEXT,
  REPLACED_STAND,
  STEP_LABELS,
  STRUCTURE_FAILED_TEXT,
  STRUCTURE_NAME,
  CheckView,
  ReportBody,
  StepName,
  StepSnapshot,
  StepState,
} from '../core/models';
import { SessionStore } from '../core/session.store';
import { ReportBlocksComponent } from '../report/report-blocks.component';

@Component({
  selector: 'app-progress',
  imports: [RouterLink, ReportBlocksComponent],
  template: `
    @if (!checkId()) {
      <h1>Ход проверки</h1>
      <p class="empty">Нет текущей проверки.</p>
    } @else if (loading() && !view()) {
      <h1>Ход проверки</h1>
      <p>Загрузка…</p>
    } @else if (error() && !view()) {
      <h1>Ход проверки</h1>
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else if (view(); as current) {
      <h1>Ход проверки</h1>
      @if (error()) {
        <p class="alert error" role="alert">{{ error() }}</p>
      }
      <p class="meta">{{ current.name }} · <span class="mono">{{ current.human_id }}</span></p>
      @if (current.replaced_previous_stand) {
        <p class="alert neutral" role="status">{{ replaced }}</p>
      }
      <ol class="steps" aria-live="polite">
        @for (step of current.steps; track step.name) {
          <li [class]="'step step-' + step.state">
            <span class="mark" aria-hidden="true">{{ mark(step) }}</span>
            <span>{{ label(step.name) }}</span>
            <span class="step-status">{{ statusText(step.state) }}</span>
            @if (step.state === 'retrying') {
              <span class="extra">Идёт повтор</span>
            }
            @if (step.state === 'failed') {
              <span class="extra">{{ failedText(step) }}</span>
            }
            @if (step.state === 'waiting_user') {
              <span class="extra">Развилка ИИ</span>
            }
          </li>
        }
      </ol>

      @if (showGate(current)) {
        <section class="card" aria-label="Развилка ИИ">
          <h2>Развилка ИИ</h2>
          <p>{{ gateText }}</p>
          @if (structureFailed(current)) {
            <p>{{ structureText }}</p>
          }
          <div class="actions">
            <button type="button" class="primary" (click)="decide('allow')" [disabled]="gateLocked()">Разрешить ИИ</button>
            <button type="button" class="secondary" (click)="decide('deny')" [disabled]="gateLocked()">Не разрешать ИИ</button>
          </div>
          @if (decisionError()) {
            <p class="alert error" role="alert">{{ decisionError() }}</p>
          }
        </section>
      } @else if (structureFailed(current)) {
        <p class="alert neutral">{{ structureText }}</p>
      }

      @if (reportReady(current)) {
        <p><a routerLink="/reports/{{ current.check_id }}">Отчёт</a></p>
      }
      @if (current.stand_url) {
        <p><a routerLink="/checks/{{ current.check_id }}/stand">Стенд</a></p>
      }

      <app-report-blocks [data]="body(current)" idPrefix="progress" />
    }
  `,
})
export class ProgressComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly checkId = signal('');
  readonly view = signal<CheckView | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly gateLocked = signal(false);
  readonly decisionError = signal('');
  readonly replaced = REPLACED_STAND;
  readonly gateText = AI_GATE_TEXT;
  readonly structureText = STRUCTURE_FAILED_TEXT;
  private timer = 0;
  private pollSub: Subscription | null = null;
  private generation = 0;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('checkId') ?? '';
      if (!id) {
        const remembered = this.session.lastCheckId();
        if (remembered) {
          void this.router.navigate(['/checks', remembered]);
          return;
        }
        this.checkId.set('');
        this.view.set(null);
        this.stopPoll();
        return;
      }
      this.checkId.set(id);
      this.session.rememberCheck(id);
      this.poll(true);
    });
    this.destroyRef.onDestroy(() => this.stopPoll());
  }

  label(name: StepName): string {
    return STEP_LABELS[name] ?? name;
  }

  statusText(state: StepState): string {
    switch (state) {
      case 'done':
        return 'выполнено';
      case 'running':
      case 'retrying':
        return 'идёт';
      case 'pending':
        return 'ожидает';
      case 'skipped':
        return 'пропущен';
      case 'failed':
        return 'ошибка';
      case 'waiting_user':
        return 'нужно решение';
    }
  }

  failedText(step: StepSnapshot): string {
    return step.message || 'Ошибка этой части';
  }

  mark(step: StepSnapshot): string {
    if (step.state === 'done') return '✓';
    if (step.state === 'failed') return '!';
    if (step.state === 'running' || step.state === 'retrying') return '…';
    return '';
  }

  showGate(view: CheckView): boolean {
    return view.steps.some((step) => step.name === 'ai_gate' && step.state === 'waiting_user');
  }

  structureFailed(view: CheckView): boolean {
    return (view.static?.items ?? []).some((item) => item.name === STRUCTURE_NAME && item.status === 'failed');
  }

  reportReady(view: CheckView): boolean {
    return view.steps.some((step) => step.name === 'report' && step.state === 'done');
  }

  body(view: CheckView): ReportBody {
    return {
      name: view.name,
      human_id: view.human_id,
      countries: view.countries ?? [],
      languages: view.languages ?? [],
      created_at: '',
      lander_type_name: view.lander_type_name ?? '',
      catalog_status: view.catalog_status ?? '',
      static: view.static,
      ai: view.ai,
      ai_note: aiFailureNote(view.steps),
      lighthouse: view.lighthouse,
    };
  }

  decide(decision: 'allow' | 'deny'): void {
    const id = this.checkId();
    const view = this.view();
    if (!id || !view || !this.showGate(view) || this.gateLocked()) return;
    this.gateLocked.set(true);
    this.decisionError.set('');
    this.api.aiDecision(id, decision).subscribe({
      next: () => {
        this.poll(true);
      },
      error: (error: unknown) => {
        this.gateLocked.set(false);
        this.decisionError.set(errorText(error, 'Решение не отправлено.'));
      },
    });
  }

  private poll(immediate: boolean): void {
    this.stopPoll();
    const id = this.checkId();
    if (!id) return;
    const generation = ++this.generation;
    const ticks = new Subject<void>();
    this.loading.set(immediate && !this.view());
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
        this.loading.set(false);
        this.error.set('');
        if (!this.showGate(view)) this.gateLocked.set(false);
        this.view.set(view);
        if (!shouldPoll(view.steps)) this.stopTimer();
      });
    const kick = () => {
      if (generation !== this.generation) return;
      ticks.next();
    };
    if (immediate) kick();
    this.timer = window.setInterval(kick, 1500);
  }

  private onPollError(id: string, error: unknown): void {
    if (this.checkId() !== id) return;
    this.loading.set(false);
    this.error.set(errorText(error, 'Не удалось получить ход проверки.'));
    if (error instanceof HttpErrorResponse && error.status === 401) {
      this.stopTimer();
      return;
    }
    if (!this.view()) this.stopTimer();
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

function aiFailureNote(steps: StepSnapshot[]): string {
  const step = steps.find((item) => item.name === 'ai');
  return step?.state === 'failed' && step.message ? step.message : '';
}
