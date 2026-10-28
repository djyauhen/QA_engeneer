import { Component, ElementRef, computed, input, signal, viewChild } from '@angular/core';
import {
  AiFinding,
  AiGeneral,
  LH_METRICS,
  RECOMMENDATION,
  ReportBody,
  STRUCTURE_FAILED_TEXT,
  STRUCTURE_NAME,
} from '../core/models';
import {
  completeAiCard,
  findingPath,
  formatTimestamp,
  isImageSource,
  isSignedUrl,
  joinList,
  lighthouseImageSrc,
  metricValue,
  qaCategoryLabel,
  qaPriorityText,
  qaStatusKey,
  qaStatusText,
} from '../core/format';

interface AiCardView {
  path: string;
  quote: string;
  screenshot: string;
  category: number | null;
  priority: string;
  where: string;
  problem: string;
  expected: string;
}

const GENERAL_ROWS: Array<{ key: keyof AiGeneral; label: string }> = [
  { key: 'geo', label: 'GEO' },
  { key: 'language', label: 'Язык' },
  { key: 'outlet', label: 'Новостник' },
  { key: 'main_person', label: 'Главный персонаж' },
  { key: 'offer', label: 'Основной оффер' },
  { key: 'currency', label: 'Валюта' },
  { key: 'min_deposit', label: 'Минимальный депозит' },
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

@Component({
  selector: 'app-report-blocks',
  template: `
    @if (heading()) {
      <h2>{{ heading() }}</h2>
    }
    @if (showRecommendation()) {
      <p class="recommendation">{{ recommendation }}</p>
    }
    <dl class="facts">
      @if (data().name) {
        <div>
          <dt>Название</dt>
          <dd>{{ data().name }}</dd>
        </div>
      }
      @if (data().human_id) {
        <div>
          <dt>human_id</dt>
          <dd class="mono">{{ data().human_id }}</dd>
        </div>
      }
      @if (joinList(data().countries)) {
        <div>
          <dt>Страны</dt>
          <dd>{{ joinList(data().countries) }}</dd>
        </div>
      }
      @if (joinList(data().languages)) {
        <div>
          <dt>Языки</dt>
          <dd>{{ joinList(data().languages) }}</dd>
        </div>
      }
      @if (data().lander_type_name) {
        <div>
          <dt>Тип</dt>
          <dd>{{ data().lander_type_name }}</dd>
        </div>
      }
      @if (data().catalog_status) {
        <div>
          <dt>Статус в каталоге</dt>
          <dd>{{ data().catalog_status }}</dd>
        </div>
      }
      @if (showDate() && data().created_at) {
        <div>
          <dt>Дата отчёта</dt>
          <dd>{{ formatTimestamp(data().created_at) }}</dd>
        </div>
      }
    </dl>

    <section class="block" [attr.aria-labelledby]="sectionId('static-title')">
      <header class="block-head">
        @if (nested()) {
          <h3 [id]="sectionId('static-title')">Статика</h3>
        } @else {
          <h2 [id]="sectionId('static-title')">Статика</h2>
        }
        @if (data().static?.summary) {
          <span class="chip">{{ data().static?.summary }}</span>
        }
      </header>
      @if (structureFailed()) {
        <p class="alert neutral">{{ structureText }}</p>
      }
      <p class="hint">Статус пункта. Не вердикт страницы.</p>
      @for (item of data().static?.items ?? []; track item.name) {
        <article class="static-item">
          <div class="static-head">
            @if (nested()) {
              <h4>{{ item.name }}</h4>
            } @else {
              <h3>{{ item.name }}</h3>
            }
            <span class="badge" [attr.data-status]="item.status">{{ statusText(item.status) }}</span>
          </div>
          @for (finding of item.findings; track $index) {
            <p>{{ finding.text }}</p>
            @if (findingPath(finding)) {
              <p class="mono path">{{ findingPath(finding) }}</p>
            }
          }
        </article>
      }
    </section>

    @if (data().ai; as ai) {
      <section class="block" [attr.aria-labelledby]="sectionId('ai-title')">
        <header class="block-head">
          @if (nested()) {
            <h3 [id]="sectionId('ai-title')">ИИ</h3>
          } @else {
            <h2 [id]="sectionId('ai-title')">ИИ</h2>
          }
          @if (ai.status) {
            <span class="chip">{{ ai.status }}</span>
          }
        </header>
        @if (data().ai_note) {
          <p class="hint">{{ data().ai_note }}</p>
        }

        @if (generalRows().length > 0 || ai.meta?.person_conflict) {
          @if (nested()) {
            <h4>Общая информация</h4>
          } @else {
            <h3>Общая информация</h3>
          }
          @if (generalRows().length > 0) {
            <dl class="facts">
              @for (row of generalRows(); track row.label) {
                <div>
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              }
            </dl>
          }
          @if (ai.meta?.person_conflict) {
            <p class="hint">
              Имя в названии ленда и в тексте различаются.
              @if (personFromName()) {
                В названии: {{ personFromName() }}.
              }
              @if (personFromText()) {
                В тексте: {{ personFromText() }}.
              }
            </p>
          }
        }

        @if (ai.checks?.length) {
          @if (nested()) {
            <h4>Проверки по критериям</h4>
          } @else {
            <h3>Проверки по критериям</h3>
          }
          <ul class="qa-categories">
            @for (check of ai.checks; track $index) {
              <li>
                <span class="qa-category-name">{{ categoryLabel(check.category) }}</span>
                <span class="badge" [attr.data-status]="statusKey(check.status)">{{ qaStatus(check.status) }}</span>
                @if (check.note) {
                  <span class="hint qa-note">{{ check.note }}</span>
                }
              </li>
            }
          </ul>
        }

        @for (card of aiCards(); track $index) {
          <article class="ai-card">
            @if (card.priority || card.category !== null) {
              <p class="ai-meta">
                @if (card.priority) {
                  <span class="chip priority" [attr.data-priority]="card.priority">{{ priorityText(card.priority) }}</span>
                }
                @if (card.category !== null) {
                  <span class="ai-category">{{ categoryLabel(card.category) }}</span>
                }
              </p>
            }
            <p class="mono path">{{ card.path }}</p>
            <blockquote>{{ card.quote }}</blockquote>
            @if (card.where) {
              <p><strong>Где:</strong> {{ card.where }}</p>
            }
            @if (card.problem) {
              <p><strong>Проблема:</strong> {{ card.problem }}</p>
            }
            @if (card.expected) {
              <p><strong>Ожидается:</strong> {{ card.expected }}</p>
            }
            @if (showImage(card.screenshot)) {
              <button
                type="button"
                class="thumb"
                [attr.aria-label]="'Открыть изображение к находке ' + ($index + 1)"
                (click)="openImage(card.screenshot, imageAlt(card, $index))"
              >
                <img [src]="card.screenshot" [alt]="imageAlt(card, $index)" loading="lazy" />
              </button>
            } @else if (!signed(card.screenshot)) {
              <p>{{ card.screenshot }}</p>
            } @else {
              <p class="hint">Скриншот</p>
            }
          </article>
        }

        @if (ai.clarifications?.length) {
          @if (nested()) {
            <h4>Требует уточнения</h4>
          } @else {
            <h3>Требует уточнения</h3>
          }
          <ul class="qa-clarifications">
            @for (item of ai.clarifications; track $index) {
              <li>{{ item }}</li>
            }
          </ul>
        }

        @if (ai.report_markdown) {
          <details class="qa-report-box">
            <summary>Текст отчёта ИИ</summary>
            <pre class="qa-report">{{ ai.report_markdown }}</pre>
          </details>
        }
      </section>
    }

    <section class="block" [attr.aria-labelledby]="sectionId('lh-title')">
      <header class="block-head">
        @if (nested()) {
          <h3 [id]="sectionId('lh-title')">Lighthouse</h3>
        } @else {
          <h2 [id]="sectionId('lh-title')">Lighthouse</h2>
        }
        @if (data().lighthouse?.status) {
          <span class="chip">{{ data().lighthouse?.status }}</span>
        }
      </header>
      <div class="lh-groups">
        <section aria-label="Мобильная">
          @if (nested()) {
            <h4>Мобильная</h4>
          } @else {
            <h3>Мобильная</h3>
          }
          @for (metric of metrics; track metric.key) {
            <div class="metric">
              <span>{{ metric.label }}</span>
              <span class="mono">{{ metricValue(data().lighthouse?.mobile ?? null, metric.key) }}</span>
            </div>
          }
          @if (lighthouseImage(data().lighthouse?.mobile?.screenshot); as shot) {
            <button
              type="button"
              class="thumb"
              aria-label="Открыть скриншот мобильной версии"
              (click)="openImage(shot, 'Скриншот мобильной версии')"
            >
              <img [src]="shot" alt="Скриншот мобильной версии" />
            </button>
          }
        </section>
        <section aria-label="Компьютер">
          @if (nested()) {
            <h4>Компьютер</h4>
          } @else {
            <h3>Компьютер</h3>
          }
          @for (metric of metrics; track metric.key) {
            <div class="metric">
              <span>{{ metric.label }}</span>
              <span class="mono">{{ metricValue(data().lighthouse?.desktop ?? null, metric.key) }}</span>
            </div>
          }
          @if (lighthouseImage(data().lighthouse?.desktop?.screenshot); as shot) {
            <button
              type="button"
              class="thumb"
              aria-label="Открыть скриншот компьютерной версии"
              (click)="openImage(shot, 'Скриншот компьютерной версии')"
            >
              <img [src]="shot" alt="Скриншот компьютерной версии" />
            </button>
          }
        </section>
      </div>
    </section>

    <dialog #zoom class="image-dialog" aria-label="Изображение к находке" (close)="zoomed.set(null)">
      @if (zoomed(); as image) {
        <img [src]="image.src" [alt]="image.alt" />
      }
      <form method="dialog">
        <button type="submit" class="secondary">Закрыть</button>
      </form>
    </dialog>
  `,
})
export class ReportBlocksComponent {
  readonly data = input.required<ReportBody>();
  readonly heading = input('');
  readonly idPrefix = input('report');
  readonly showDate = input(false);
  readonly showRecommendation = input(false);
  readonly recommendation = RECOMMENDATION;
  readonly structureText = STRUCTURE_FAILED_TEXT;
  readonly metrics = LH_METRICS;
  readonly lighthouseImage = lighthouseImageSrc;
  readonly formatTimestamp = formatTimestamp;
  readonly joinList = joinList;
  readonly findingPath = findingPath;
  readonly metricValue = metricValue;
  readonly categoryLabel = qaCategoryLabel;
  readonly qaStatus = qaStatusText;
  readonly statusKey = qaStatusKey;
  readonly priorityText = qaPriorityText;

  readonly zoom = viewChild<ElementRef<HTMLDialogElement>>('zoom');
  readonly zoomed = signal<{ src: string; alt: string } | null>(null);

  /** With a column heading the column title is h2, so inner section titles shift one level down. */
  readonly nested = computed(() => this.heading() !== '');

  readonly generalRows = computed(() => {
    const general = this.data().ai?.general;
    if (!general) return [];
    const rows: Array<{ label: string; value: string }> = [];
    for (const row of GENERAL_ROWS) {
      const value = text(general[row.key]);
      if (value) rows.push({ label: row.label, value });
    }
    return rows;
  });

  readonly personFromName = computed(() => text(this.data().ai?.meta?.person_from_name));
  readonly personFromText = computed(() => text(this.data().ai?.meta?.person_from_text));

  sectionId(part: string): string {
    return `${this.idPrefix()}-${part}`;
  }

  statusText(status: string): string {
    if (status === 'passed') return 'пройдено';
    if (status === 'warning') return 'предупреждение';
    if (status === 'failed') return 'ошибка';
    return status;
  }

  structureFailed(): boolean {
    const items = this.data().static?.items ?? [];
    return items.some((item) => item.name === STRUCTURE_NAME && item.status === 'failed');
  }

  aiCards(): AiCardView[] {
    const findings: AiFinding[] = this.data().ai?.findings ?? [];
    const cards: AiCardView[] = [];
    for (const finding of findings) {
      const card = completeAiCard(finding);
      if (!card) continue;
      cards.push({
        ...card,
        category: typeof finding.category === 'number' ? finding.category : null,
        priority: text(finding.priority),
        where: text(finding.where),
        problem: text(finding.problem),
        expected: text(finding.expected),
      });
    }
    return cards;
  }

  imageAlt(card: AiCardView, index: number): string {
    const quote = card.quote.length > 80 ? `${card.quote.slice(0, 80)}…` : card.quote;
    return quote ? `Изображение к находке ${index + 1}: ${quote}` : `Изображение к находке ${index + 1}`;
  }

  openImage(src: string, alt: string): void {
    this.zoomed.set({ src, alt });
    const dialog = this.zoom()?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  }

  showImage(screenshot: string): boolean {
    return isImageSource(screenshot) && !isSignedUrl(screenshot);
  }

  signed(screenshot: string): boolean {
    return isSignedUrl(screenshot);
  }
}
