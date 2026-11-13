# QA Assistant

Два независимых npm-пакета в одном репозитории, без корневого `package.json`.

- `frontend/` — Angular 21 (`qa-assistant`). В dev `apiBaseUrl` пустой: запросы идут через прокси dev-сервера на порт Nest. Production-сборка подставляет origin API из `API_BASE_URL` (по умолчанию `https://bdc-it.uk`).
- `backend/` — NestJS. Postgres (Neon), сессии в таблице `sessions`, файлы проверки в `WORK_DIR` и zip в `check_archives`. Точка входа — `src/main.ts`: `bootstrap()` вызывает `app.listen()` на `127.0.0.1` (порт `PORT`, по умолчанию 3000).

## Прод

Один прод — VPS. Сборка, nginx и TLS описаны в [DEPLOY.md](DEPLOY.md). Публичный адрес: `https://bdc-it.uk`. API снаружи не публикуется: процесс слушает `127.0.0.1:3000`, nginx проксирует на него.

Логин возвращает `session_id` в JSON. Перехватчик Angular отправляет его заголовком `X-Session-Id`. Пока `FRONTEND_ORIGIN` пуст, бэкенд отражает origin запроса. Когда переменная задана, разрешены только перечисленные origin.

## Локальный запуск

Локальная база — Postgres в Docker, не Neon. Из корня репозитория: `docker compose up -d`. Контейнер `qa-postgres` (образ `postgres:16`) слушает `127.0.0.1:5432`, база `qa`, пользователь `qa`. В `backend/.env` для него стоит `DATABASE_URL` с `sslmode=disable` и `STORAGE=neon`. Остановить: `docker compose stop`. Поднять снова: `docker compose up -d`.

В каталоге `frontend/` и в каталоге `backend/` — `npm start`. Скрипт backend запускает `dist/main.js`, поэтому перед первым запуском выполните `npm run build`. Имена секретов — в `backend/.env.example`. Реальные значения в репозиторий не класть.
