# Помощник QA — frontend

Angular 21. Интерфейс ходит в Nest API с cookie-сессией и заголовком `X-Session-Id`.

## Установка

```powershell
npm.cmd install
```

## Запуск

```powershell
npm.cmd start
```

В dev `apiBaseUrl` в `src/environments/environment.ts` пустой: запросы идут через прокси dev-сервера (`proxy.conf.json` → `http://127.0.0.1:3000`) на локальный Nest. Абсолютный адрес сюда не подставляйте — иначе прокси не используется.

Production-сборка подменяет `environment.ts` на `environment.production.ts`, который берёт `apiBaseUrl` из `src/environments/api-base.ts`. Скрипт `scripts/apply-api-base.mjs` записывает origin из `API_BASE_URL`, а если переменная не задана — origin развёрнутого API без завершающего слэша.

## Сборка

```powershell
npm.cmd run build
```
