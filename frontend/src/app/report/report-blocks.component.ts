import { Component, input } from '@angular/core';
import {
  LH_METRICS,
  RECOMMENDATION,
  ReportBody,
  STRUCTURE_FAILED_TEXT,
  STRUCTURE_NAME,
} from '../core/models';
import { completeAiCard, findingPath, formatTimestamp, isImageSource, isSignedUrl, joinList, metricValue } from '../core/format';

@Component({
  selector: 'app-report-blocks',
  template: `
    @if (heading()) {
      <h1>{{ heading() }}</h1>
    }
    @if (showRecommendation()) {
      <p class="recommendation">{{ recommendation }}</p>
    }
    <dl class="facts">
      <div>
        <dt>Название</dt>
        <dd>{{ data().name }}</dd>
      </div>
      <div>
        <dt>human_id</dt>
        <dd class="mono">{{ data().human_id }}</dd>
      </div>
      <div>
        <dt>Страны</dt>
        <dd>{{ joinList(data().countries) }}</dd>
      </div>
      <div>
        <dt>Языки</dt>
        <dd>{{ joinList(data().languages) }}</dd>
      </div>
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

    <section class="block" aria-labelledby="static-title">
      <header class="block-head">
        <h2 id="static-title">Статика</h2>
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
            <h3>{{ item.name }}</h3>
            <span class="badge" [attr.data-status]="item.status">{{ item.status }}</span>
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

    <section class="block" aria-labelledby="ai-title">
      <header class="block-head">
        <h2 id="ai-title">ИИ</h2>
        @if (data().ai?.status) {
          <span class="chip">{{ data().ai?.status }}</span>
        }
      </header>
      @for (card of aiCards(); track card.path + card.quote) {
        <article class="ai-card">
          <p class="mono path">{{ card.path }}</p>
          <blockquote>{{ card.quote }}</blockquote>
          @if (showImage(card.screenshot)) {
            <img [src]="card.screenshot" alt="Скриншот" />
          } @else if (!signed(card.screenshot)) {
            <p>{{ card.screenshot }}</p>
          } @else {
            <p class="hint">Скриншот</p>
          }
        </article>
      }
    </section>

    <section class="block" aria-labelledby="lh-title">
      <header class="block-head">
        <h2 id="lh-title">Lighthouse</h2>
        @if (data().lighthouse?.status) {
          <span class="chip">{{ data().lighthouse?.status }}</span>
        }
      </header>
      <div class="lh-groups">
        <section aria-label="mobile">
          <h3>mobile</h3>
          @for (metric of metrics; track metric.key) {
            <div class="metric">
              <span>{{ metric.label }}</span>
              <span class="mono">{{ metricValue(data().lighthouse?.mobile ?? null, metric.key) }}</span>
            </div>
          }
        </section>
        <section aria-label="desktop">
          <h3>desktop</h3>
          @for (metric of metrics; track metric.key) {
            <div class="metric">
              <span>{{ metric.label }}</span>
              <span class="mono">{{ metricValue(data().lighthouse?.desktop ?? null, metric.key) }}</span>
            </div>
          }
        </section>
      </div>
    </section>
  `,
})
export class ReportBlocksComponent {
  readonly data = input.required<ReportBody>();
  readonly heading = input('');
  readonly showDate = input(false);
  readonly showRecommendation = input(false);
  readonly recommendation = RECOMMENDATION;
  readonly structureText = STRUCTURE_FAILED_TEXT;
  readonly metrics = LH_METRICS;
  readonly formatTimestamp = formatTimestamp;
  readonly joinList = joinList;
  readonly findingPath = findingPath;
  readonly metricValue = metricValue;

  structureFailed(): boolean {
    const items = this.data().static?.items ?? [];
    return items.some((item) => item.name === STRUCTURE_NAME && item.status === 'failed');
  }

  aiCards(): Array<{ path: string; quote: string; screenshot: string }> {
    const findings = this.data().ai?.findings ?? [];
    const cards = [];
    for (const finding of findings) {
      const card = completeAiCard(finding);
      if (card) cards.push(card);
    }
    return cards;
  }

  showImage(screenshot: string): boolean {
    return isImageSource(screenshot);
  }

  signed(screenshot: string): boolean {
    return isSignedUrl(screenshot);
  }
}
