# QA Assistant

Два независимых npm-пакета, без корневого `package.json`.

- `frontend/` — Angular 21 (`qa-assistant`). Сборка из каталога `frontend/`: `npm ci && npm run build`. Статика с `index.html` лежит в `frontend/dist/qa-assistant/browser`. Роутер path-based, нужен SPA fallback на `index.html`. `apiBaseUrl` пустой: запросы идут на тот же origin. В dev проксируются префиксы `/session`, `/catalog`, `/checks`, `/reports`, `/admin`, `/preview`.
- `backend/` — NestJS, Postgres, сессии в памяти, файлы в локальном `WORK_DIR`, опционально Lighthouse/Chrome. Это долгоживущий процесс с диском. На Vercel (serverless) его не переносят.

## Деплой (Vercel + GitHub)

На Vercel публикуется только статический фронтенд. API остаётся на отдельном хосте.

1. Импортируйте GitHub-репозиторий в Vercel.
2. **Root Directory** — корень репозитория (не `frontend/`).
3. **Framework Preset:** Other.
4. **Node.js:** 22.x (Angular 21).
5. Команды установки, сборки и каталог артефакта берутся из корневого `vercel.json`. Вручную их дублировать не нужно.
6. Переменные API в проект Vercel не добавляйте. Фронтенд их не читает.

Пока постоянного API-хоста нет, сайт — статика. Логин не заработает, пока rewrites не проксируют префиксы API. Это ожидаемо.

Когда появится постоянный HTTPS-хост API (контейнер или VM, не Vercel), добавьте эти rewrites **выше** SPA fallback в `vercel.json`. `API_ORIGIN` — хост без схемы в пути, подставьте реальный origin:

```json
{ "source": "/session", "destination": "https://API_ORIGIN/session" },
{ "source": "/session/:path*", "destination": "https://API_ORIGIN/session/:path*" },
{ "source": "/catalog", "destination": "https://API_ORIGIN/catalog" },
{ "source": "/catalog/:path*", "destination": "https://API_ORIGIN/catalog/:path*" },
{ "source": "/checks", "destination": "https://API_ORIGIN/checks" },
{ "source": "/checks/:path*", "destination": "https://API_ORIGIN/checks/:path*" },
{ "source": "/reports", "destination": "https://API_ORIGIN/reports" },
{ "source": "/reports/:path*", "destination": "https://API_ORIGIN/reports/:path*" },
{ "source": "/admin", "destination": "https://API_ORIGIN/admin" },
{ "source": "/admin/:path*", "destination": "https://API_ORIGIN/admin/:path*" },
{ "source": "/preview", "destination": "https://API_ORIGIN/preview" },
{ "source": "/preview/:path*", "destination": "https://API_ORIGIN/preview/:path*" }
```

### Хост API

Из каталога `backend/`:

```bash
npm ci && npm run build && npm start
```

Секреты задаются только в окружении этого хоста. Имена — в `backend/.env.example`. Реальные значения в репозиторий не класть. `LIGHTHOUSE_MODE=stub`, пока на хосте нет Chrome. `PUBLIC_BASE_URL` должен совпадать с origin сайта на Vercel, когда `/preview` уже проксируется.

Chrome и Lighthouse на Vercel не запускаются. Nest в serverless-функцию не переносится. Сессии и `WORK_DIR` требуют одного долгоживущего процесса и диска.
