import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { errorText } from '../core/http-error';
import { shouldPoll } from '../core/format';
import {
  AI_GATE_TEXT,
  REPLACED_STAND,
  STATIC_SUMMARY_FAILED,
  STEP_LABELS,
  STRUCTURE_FAILED_TEXT,
  STRUCTURE_NAME,
  CheckView,
  ReportBody,
  StepName,
  StepSnapshot,
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
    } @else if (error()) {
      <h1>Ход проверки</h1>
      <p class="alert error" role="alert">{{ error() }}</p>
    } @else if (view(); as current) {
      <h1>Ход проверки</h1>
      <p class="meta">{{ current.name }} · <span class="mono">{{ current.human_id }}</span></p>
      @if (current.replaced_previous_stand) {
        <p class="alert neutral" role="status">{{ replaced }}</p>
      }
      <ol class="steps">
        @for (step of current.steps; track step.name) {
          <li [class]="'step step-' + step.state">
            <span class="mark" aria-hidden="true">{{ mark(step) }}</span>
            <span>{{ label(step.name) }}</span>
            @if (step.state === 'retrying') {
              <span class="extra">Идёт повтор</span>
            }
            @if (step.state === 'failed') {
              <span class="extra">Ошибка этой части</span>
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
            <button type="button" class="primary" (click)="decide('allow')" [disabled]="deciding()">Разрешить ИИ</button>
            <button type="button" class="secondary" (click)="decide('deny')" [disabled]="deciding()">Не разрешать ИИ</button>
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

      <app-report-blocks [data]="body(current)" />
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
  readonly deciding = signal(false);
  readonly decisionError = signal('');
  readonly replaced = REPLACED_STAND;
  readonly gateText = AI_GATE_TEXT;
  readonly structureText = STRUCTURE_FAILED_TEXT;
  private timer = 0;

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
        return;
      }
      this.checkId.set(id);
      this.session.rememberCheck(id);
      this.poll(true);
    });
    this.destroyRef.onDestroy(() => window.clearInterval(this.timer));
  }

  label(name: StepName): string {
    return STEP_LABELS[name] ?? name;
  }

  mark(step: StepSnapshot): string {
    if (step.state === 'done') return '✓';
    if (step.state === 'failed') return '!';
    if (step.state === 'running' || step.state === 'retrying') return '…';
    return '';
  }

  showGate(view: CheckView): boolean {
    const gate = view.steps.find((step) => step.name === 'ai_gate');
    return view.static?.summary === STATIC_SUMMARY_FAILED && gate?.state === 'waiting_user';
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
      countries: [],
      languages: [],
      created_at: '',
      lander_type_name: '',
      catalog_status: '',
      static: view.static,
      ai: view.ai,
      lighthouse: view.lighthouse,
    };
  }

  decide(decision: 'allow' | 'deny'): void {
    const id = this.checkId();
    const view = this.view();
    if (!id || !view || !this.showGate(view) || this.deciding()) return;
    this.deciding.set(true);
    this.decisionError.set('');
    this.api.aiDecision(id, decision).subscribe({
      next: () => {
        this.deciding.set(false);
        this.poll(false);
      },
      error: (error: unknown) => {
        this.deciding.set(false);
        this.decisionError.set(errorText(error, 'Решение не отправлено.'));
      },
    });
  }

  private poll(immediate: boolean): void {
    window.clearInterval(this.timer);
    const id = this.checkId();
    if (!id) return;
    const tick = () => {
      this.api.check(id).subscribe({
        next: (view) => {
          if (this.checkId() !== id) return;
          this.loading.set(false);
          this.error.set('');
          this.view.set(view);
          if (!shouldPoll(view.steps)) window.clearInterval(this.timer);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.error.set(errorText(error, 'Не удалось получить ход проверки.'));
          window.clearInterval(this.timer);
        },
      });
    };
    this.loading.set(immediate && !this.view());
    if (immediate) tick();
    this.timer = window.setInterval(tick, 1500);
  }
}
