# QA Assistant

Два независимых npm-пакета в одном репозитории, без корневого `package.json`.

- `frontend/` — Angular 21 (`qa-assistant`). В dev `apiBaseUrl` пустой: запросы идут через прокси dev-сервера на порт Nest. Production-сборка подставляет origin API из `API_BASE_URL`.
- `backend/` — NestJS. Postgres (Neon), сессии в памяти процесса, файлы в `WORK_DIR`. Точка входа — `src/main.ts`: `bootstrap()` вызывает `app.listen()`.

## Два проекта Vercel

Оба проекта создаются из ветки `main` одного и того же GitHub-репозитория. У каждого свой Root Directory.

### Фронтенд

- **Root Directory:** `frontend`
- **Framework Preset:** Other
- **Node.js:** 22.x
- Команды сборки и каталог артефакта берутся из `frontend/vercel.json`: `node scripts/apply-api-base.mjs && npm run build`, выход `dist/qa-assistant/browser`, SPA fallback на `index.html`.

Переменная сборки `API_BASE_URL` — origin бэкенд-проекта, без завершающего слэша. Секреты API в проект фронтенда не добавляйте.

### Бэкенд

- **Root Directory:** `backend`
- **Framework Preset:** NestJS. Vercel находит `src/main.ts` и запускает существующий `bootstrap()` / `app.listen()` одной Function.
- Поля Install, Build и Output не переопределяйте.

Переменные окружения — из `backend/.env.example`, на проекте бэкенда. Дополнительно:

- `FRONTEND_ORIGIN` — origin фронтенд-проекта (несколько значений через запятую, без завершающего слэша).
- `LIGHTHOUSE_MODE=stub`
- `CATALOG_AUTO_REFRESH=0`
- `PUBLIC_BASE_URL` — origin бэкенд-проекта (ссылки превью), не origin фронтенда.

### Порядок

1. Сначала задеплойте API.
2. Скопируйте URL API в `API_BASE_URL` проекта фронтенда и задеплойте фронтенд заново.
3. Задайте на API `FRONTEND_ORIGIN` (origin фронтенда) и `PUBLIC_BASE_URL` (origin API) и задеплойте API заново.

### Сессия

Логин возвращает `session_id` в JSON. Перехватчик Angular отправляет его заголовком `X-Session-Id`. Общая cookie на два домена не нужна. CORS бэкенда разрешает этот заголовок и `credentials`. Пока `FRONTEND_ORIGIN` пуст, бэкенд отражает origin запроса, чтобы вызовы с cookies и заголовком сессии проходили до того, как URL фронтенда известен. Когда переменная задана, разрешены только перечисленные origin.

### Ограничения на Vercel

Сессии и состояние проверок живут в памяти: холодный старт или второй инстанс их стирает. На Vercel распаковка идёт в `/tmp` этого инстанса; другой инстанс этих файлов не видит, и превью стенда тогда не открывается. Lighthouse и Chrome недоступны. Интервал обновления каталога между запросами не тикает.

## Локальный запуск

В каталоге `frontend/` и в каталоге `backend/` — `npm start`. Скрипт backend запускает `dist/main.js`, поэтому перед первым запуском выполните `npm run build`. Имена секретов — в `backend/.env.example`. Реальные значения в репозиторий не класть.
