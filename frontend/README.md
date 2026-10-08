# Помощник QA — frontend

Angular 21. Интерфейс ходит в Nest API с cookie-сессией и заголовком `X-Session-Id`.

## Установка

```powershell
npm.cmd install
```

## Запуск

API по умолчанию слушает порт **3000** (`PORT` в `backend/src/config.ts`, `loadConfig`). Dev-сервер проксирует `/session`, `/catalog`, `/checks`, `/reports`, `/admin` и `/preview` на `http://127.0.0.1:3000`.

```powershell
npm.cmd start
```

Базовый URL API задаётся в `src/environments/environment.ts` (`apiBaseUrl`). Пустая строка означает запросы на тот же origin, что и приложение.

## Сборка

```powershell
npm.cmd run build
```
