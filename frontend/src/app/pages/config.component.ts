import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { inputValue, linesToList, listToLines } from '../core/format';
import { errorText } from '../core/http-error';
import { AdminRules, NO_HISTORY } from '../core/models';

interface RulesForm {
  allowed_external_prefixes: string;
  forbidden_macros: string;
  forbidden_script_markers: string;
  image_warning_kb: string;
  image_failed_kb: string;
  css_ok_kb: string;
  css_failed_kb: string;
  inline_script_max_nonempty_lines: string;
  expectFormMacro: boolean;
  languages_override: string;
}

@Component({
  selector: 'app-config',
  template: `
    <h1>Конфиг</h1>
    <p>{{ noHistory }}</p>
    @if (loading()) {
      <p>Загрузка…</p>
    } @else if (loadError()) {
      <p class="alert error" role="alert">{{ loadError() }}</p>
    } @else if (form(); as current) {
      <form (submit)="save($event)">
        <label for="prefixes">Разрешённые внешние префиксы</label>
        <textarea id="prefixes" rows="8" [value]="current.allowed_external_prefixes" (input)="patch('allowed_external_prefixes', inputValue($event))"></textarea>

        <label for="macros">Запрещённые макросы</label>
        <textarea id="macros" rows="4" [value]="current.forbidden_macros" (input)="patch('forbidden_macros', inputValue($event))"></textarea>

        <fieldset>
          <legend>expectFormMacro</legend>
          <label class="check">
            <input type="checkbox" [checked]="current.expectFormMacro" (change)="patchFlag($event)" />
            expectFormMacro
          </label>
          <p class="hint">Не вычисляется из типа ленда.</p>
          <p class="hint">{{ formHint }}</p>
        </fieldset>

        <label for="markers">Запрещённые скриптовые признаки</label>
        <textarea id="markers" rows="8" [value]="current.forbidden_script_markers" (input)="patch('forbidden_script_markers', inputValue($event))"></textarea>

        <fieldset>
          <legend>Порог изображений</legend>
          <label for="image-warning">image_warning_kb</label>
          <input id="image-warning" inputmode="decimal" [value]="current.image_warning_kb" (input)="patch('image_warning_kb', inputValue($event))" />
          <label for="image-failed">image_failed_kb</label>
          <input id="image-failed" inputmode="decimal" [value]="current.image_failed_kb" (input)="patch('image_failed_kb', inputValue($event))" />
        </fieldset>

        <fieldset>
          <legend>Порог CSS</legend>
          <label for="css-ok">css_ok_kb</label>
          <input id="css-ok" inputmode="decimal" [value]="current.css_ok_kb" (input)="patch('css_ok_kb', inputValue($event))" />
          <label for="css-failed">css_failed_kb</label>
          <input id="css-failed" inputmode="decimal" [value]="current.css_failed_kb" (input)="patch('css_failed_kb', inputValue($event))" />
        </fieldset>

        <label for="inline">Порог встроенного скрипта</label>
        <input id="inline" inputmode="numeric" [value]="current.inline_script_max_nonempty_lines" (input)="patch('inline_script_max_nonempty_lines', inputValue($event))" />

        <label for="languages">Ожидаемые языки поверх метаданных ленда</label>
        <textarea id="languages" rows="3" [value]="current.languages_override" (input)="patch('languages_override', inputValue($event))"></textarea>
        <p class="hint">Пустое поле — брать языки ленда.</p>

        @if (saveError()) {
          <p class="alert error" role="alert">{{ saveError() }}</p>
        }
        @if (saved()) {
          <p class="alert neutral" role="status">Сохранено.</p>
        }
        <button type="submit" class="primary" [disabled]="saving()">Сохранить</button>
      </form>
    }
  `,
})
export class ConfigComponent {
  private readonly api = inject(ApiService);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly loadError = signal('');
  readonly saveError = signal('');
  readonly saved = signal(false);
  readonly form = signal<RulesForm | null>(null);
  readonly inputValue = inputValue;
  readonly noHistory = NO_HISTORY;
  readonly formHint =
    'Рядом с флагом, не одним плоским запретом. При включённом expectFormMacro в index обязателен {{form}}, запрещены {{link}} и {offer}. При выключенном флаге {{form}} запрещён, {{link}} обязателен хотя бы раз. В одном html вместе: {{aio:macros:tracker_protection_1}}, {{aio:macros:tracker_protection_2}}, {{aio:macros:tracker_protection_3}}. В index обязателен {{aio.visit.fields.offer_name.for_visitors}}.';

  constructor() {
    this.api.rules().subscribe({
      next: (rules) => {
        this.form.set(toForm(rules));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.form.set(null);
        this.loadError.set(errorText(error, 'Не удалось прочитать конфиг.'));
      },
    });
  }

  patch(key: Exclude<keyof RulesForm, 'expectFormMacro'>, value: string): void {
    const current = this.form();
    if (!current) return;
    this.saved.set(false);
    this.form.set({ ...current, [key]: value });
  }

  patchFlag(event: Event): void {
    const current = this.form();
    const target = event.target;
    if (!current || !(target instanceof HTMLInputElement)) return;
    this.saved.set(false);
    this.form.set({ ...current, expectFormMacro: target.checked });
  }

  save(event: Event): void {
    event.preventDefault();
    const current = this.form();
    if (!current) return;
    const body = fromForm(current);
    if (!body) {
      this.saveError.set('Некорректный параметр конфигурации');
      return;
    }
    this.saving.set(true);
    this.saveError.set('');
    this.api.saveRules(body).subscribe({
      next: (rules) => {
        this.form.set(toForm(rules));
        this.saving.set(false);
        this.saved.set(true);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.saveError.set(errorText(error, 'Не удалось сохранить конфиг.'));
      },
    });
  }
}

function toForm(rules: AdminRules): RulesForm {
  return {
    allowed_external_prefixes: listToLines(rules.allowed_external_prefixes),
    forbidden_macros: listToLines(rules.forbidden_macros),
    forbidden_script_markers: listToLines(rules.forbidden_script_markers),
    image_warning_kb: String(rules.image_warning_kb),
    image_failed_kb: String(rules.image_failed_kb),
    css_ok_kb: String(rules.css_ok_kb),
    css_failed_kb: String(rules.css_failed_kb),
    inline_script_max_nonempty_lines: String(rules.inline_script_max_nonempty_lines),
    expectFormMacro: rules.expectFormMacro,
    languages_override: listToLines(rules.languages_override),
  };
}

function fromForm(form: RulesForm): AdminRules | null {
  const imageWarning = numberValue(form.image_warning_kb);
  const imageFailed = numberValue(form.image_failed_kb);
  const cssOk = numberValue(form.css_ok_kb);
  const cssFailed = numberValue(form.css_failed_kb);
  const lines = numberValue(form.inline_script_max_nonempty_lines);
  if (imageWarning === null || imageFailed === null || cssOk === null || cssFailed === null || lines === null) return null;
  if (!Number.isInteger(lines)) return null;
  return {
    allowed_external_prefixes: linesToList(form.allowed_external_prefixes),
    forbidden_macros: linesToList(form.forbidden_macros),
    forbidden_script_markers: linesToList(form.forbidden_script_markers),
    image_warning_kb: imageWarning,
    image_failed_kb: imageFailed,
    css_ok_kb: cssOk,
    css_failed_kb: cssFailed,
    inline_script_max_nonempty_lines: lines,
    expectFormMacro: form.expectFormMacro,
    languages_override: linesToList(form.languages_override),
  };
}

function numberValue(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
