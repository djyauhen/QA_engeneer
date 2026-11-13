# Помощник QA — frontend

Angular 21. Сессия живёт в `sessionStorage` и уходит заголовком `X-Session-Id`. Cookie для входа не ставится.

## Установка

```powershell
npm.cmd install
```

## Запуск

```powershell
npm.cmd start
```

В dev `apiBaseUrl` в `src/environments/environment.ts` пустой: запросы идут через прокси dev-сервера (`proxy.conf.json` → `http://127.0.0.1:3000`) на локальный Nest. Абсолютный адрес сюда не подставляйте — иначе прокси не используется.

Production-сборка подменяет `environment.ts` на `environment.production.ts`, который берёт `apiBaseUrl` из `src/environments/api-base.ts`. Скрипт `scripts/apply-api-base.mjs` записывает `API_BASE_URL`. Если переменная не задана, origin — `https://bdc-it.uk`. Значение должно быть `https://` без завершающего слэша и без порта 3000.

## Сборка

```powershell
npm.cmd run build
```
