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

Базовый URL API в dev задаётся в `src/environments/environment.ts` (`apiBaseUrl`): `https://backend-chi-six-58.vercel.app/`. Абсолютный адрес идёт напрямую на этот backend. Прокси dev-сервера (`proxy.conf.json` → `http://127.0.0.1:3000`) при абсолютном `apiBaseUrl` не используется.

Production-сборка подменяет `environment.ts` на `environment.production.ts`, который берёт `apiBaseUrl` из `src/environments/api-base.ts`. По умолчанию там тот же backend без завершающего слэша. Скрипт `scripts/apply-api-base.mjs` записывает это значение, если `API_BASE_URL` не задан, и подставляет `API_BASE_URL`, если переменная задана.

## Сборка

```powershell
npm.cmd run build
```
