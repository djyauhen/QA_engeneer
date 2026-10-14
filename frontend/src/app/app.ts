import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly title = inject(Title);
  private readonly router = inject(Router);

  constructor() {
    const apply = () => this.title.setTitle(screenTitle(this.router.url));
    apply();
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => apply());
  }
}

export function screenTitle(url: string): string {
  const path = url.split(/[?#]/)[0] || '/';
  if (path === '/login') return 'Вход';
  if (path === '/launch') return 'Запуск проверки';
  if (path === '/reports') return 'Отчёты';
  if (path.endsWith('/compare')) return 'Сравнение';
  if (path.startsWith('/reports/')) return 'Отчёт';
  if (path === '/stand' || path.includes('/stand')) return 'Стенд';
  if (path === '/progress' || path.startsWith('/checks/')) return 'Ход проверки';
  if (path === '/costs') return 'Затраты';
  if (path === '/config') return 'Конфиг';
  if (path === '/users') return 'Пользователи';
  if (path === '/catalog-query') return 'Каталог AIO';
  return 'Помощник QA';
}
