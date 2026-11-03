# Деплой QA Assistant

Продакшен выкладывает workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) («Build and deploy»). Сборка идёт на GitHub Actions. На сервер по SSH попадает уже собранный Nest (`node dist/main.js`) и статика Angular. nginx отдаёт эту статику. API слушает порт 3000.

[`docker-compose.yml`](docker-compose.yml) поднимает локальный Postgres 16 для разработки (контейнер `qa-postgres`, порт `127.0.0.1:5432`). Workflow его не копирует и не запускает. Продуктовая база задаётся только `DATABASE_URL` в серверном `.env`.

## Что делает workflow

Запуск: push в ветку `main` и ручной `workflow_dispatch`. Одновременно выполняется одна выкладка (`concurrency.group: vps-deploy`, `cancel-in-progress: false`): следующая ждёт окончания текущей.

Job `build` (ubuntu-latest, Node.js 22, npm 11.19.0 через Corepack):

1. `backend`: `npm ci`, `npm test`, `npm run build`. Сборка обязана оставить `backend/dist/main.js`.
2. `frontend`: переменная `API_BASE_URL` обязана начинаться с `http://` или `https://`. Дальше `npm ci`, `npm test`, `node scripts/apply-api-base.mjs`, `npm run build`. Сборка обязана оставить `frontend/dist/qa-assistant/browser/index.html`.
3. В артефакт `release` (хранится 1 день) попадают `backend/package.json`, `backend/package-lock.json`, `backend/dist` и содержимое `frontend/dist/qa-assistant/browser/`.

Job `deploy` скачивает артефакт, поднимает SSH-агент с секретом `SSH_PRIVATE_KEY`, записывает host key через `ssh-keyscan` и публикует релиз `rsync` по SSH. На сервере затем `npm ci --omit=dev` и `systemctl --user restart qa-backend`. Через 3 секунды юнит должен быть в состоянии `active`.

Красный тест или отсутствующий `dist/main.js` / `index.html` останавливают выкладку до SSH.

## Хост, пользователь и пути

| | |
| --- | --- |
| Хост | `206.188.197.105` |
| Пользователь SSH | `deploy` |
| Каталог | `/home/deploy/qa_test` |
| Node | `/usr/bin/node` (Node.js 22) |
| API | пользовательский юнит systemd `qa-backend`, порт 3000 |
| Статика | nginx, корень `/home/deploy/qa_test/frontend`, порт 80 |
| SSH-порт | 22, если секрет `SSH_PORT` не задан |

Публичный сайт: `http://bdc-it.uk/`. Публичный API: `http://bdc-it.uk:3000`.

Браузер открывает сайт по `http://bdc-it.uk/` и сам вызывает API на порту 3000 этого домена (`http://bdc-it.uk:3000`). nginx порт 3000 не проксирует, поэтому он должен оставаться открытым. `API_BASE_URL` вшивается в сборку фронтенда: смена адреса требует новой сборки, а не правки уже выложенных файлов.

## Секреты и переменные GitHub

Репозиторий → Settings → Secrets and variables → Actions.

Обязательный секрет:

- `SSH_PRIVATE_KEY` — приватный ключ OpenSSH целиком, вместе со строками `BEGIN` и `END`. Этим ключом runner входит как `deploy`.

Необязательный секрет:

- `SSH_PORT` — порт SSH, если он отличается от 22. Пустое значение означает порт 22.

Необязательная переменная репозитория (Variables, не Secrets):

- `API_BASE_URL` — публичный origin API без завершающего слэша. По умолчанию `http://bdc-it.uk:3000`. Значение вшивается в статику фронтенда на шаге `scripts/apply-api-base.mjs`: браузер затем ходит на этот origin напрямую, на порт 3000. Смена адреса требует новой сборки. Это не переменная серверного `.env`.

Пароли, строки `DATABASE_URL` и приватные ключи в git не кладутся. В `authorized_keys` на сервере лежит только публичная строка, например `ssh-ed25519 AAAA... github-actions-deploy`.

## Одноразовая настройка сервера

Команды ниже рассчитаны на Debian/Ubuntu. Их выполняют один раз до первого зелёного workflow. Репозиторий на сервер клонировать не нужно: код приезжает только как артефакт `rsync`.

### DNS

У регистратора создают A-запись `bdc-it.uk` → `206.188.197.105`. Пока она не указывает на этот IP, `http://bdc-it.uk/` и `http://bdc-it.uk:3000` снаружи не откроются. Команды SSH (`ssh`, `scp`, `ssh-keyscan`) по-прежнему используют `206.188.197.105`, не домен.

### Пользователь и ключ

Ключ создают на своей машине, не в репозитории:

```bash
ssh-keygen -t ed25519 -C github-actions-deploy -f github-actions-deploy -N ""
```

Приватный файл `github-actions-deploy` вставляют в секрет `SSH_PRIVATE_KEY`. Публичный `github-actions-deploy.pub` — в `authorized_keys`. В репозиторий оба файла не коммитят.

На сервере:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo mkdir -p /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo tee /home/deploy/.ssh/authorized_keys >/dev/null <<'EOF'
ssh-ed25519 AAAA... github-actions-deploy
EOF
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo chown -R deploy:deploy /home/deploy/.ssh
```

Строку `ssh-ed25519 AAAA...` заменяют содержимым своего `.pub`.

### Пакеты

```bash
sudo apt-get update
sudo apt-get install -y rsync nginx ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
test -x /usr/bin/node
/usr/bin/node -v
npm -v
```

`/usr/bin/node` должен быть Node.js 22. Workflow вызывает именно этот путь и затем `npm ci --omit=dev` от пользователя `deploy`. `npm` обязан быть в `PATH` этого пользователя (`/usr/bin/npm`).

Открытые порты: SSH (22 или значение `SSH_PORT`), 80 (сайт) и 3000 (API). Браузер вызывает API напрямую на порту 3000 домена `bdc-it.uk`, поэтому этот порт закрывать нельзя. Если включён firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 3000/tcp
```

### Каталоги

```bash
sudo -u deploy mkdir -p /home/deploy/qa_test/backend /home/deploy/qa_test/frontend
sudo chmod 755 /home/deploy /home/deploy/qa_test
```

Каталог `/home/deploy` должен быть доступен на чтение пользователю nginx (`www-data`). Иначе статика с `root /home/deploy/qa_test/frontend` не откроется.

### Файл .env

Шаблон — [`backend/.env.example`](backend/.env.example). На сервер его копируют со своей машины и заполняют уже на месте:

```bash
scp -P 22 backend/.env.example deploy@206.188.197.105:/home/deploy/qa_test/backend/.env
ssh -p 22 deploy@206.188.197.105 'chmod 600 /home/deploy/qa_test/backend/.env'
```

Дальше правят `/home/deploy/qa_test/backend/.env` на сервере. Файл `.env` не коммитят и не кладут в git. Workflow его не создаёт и не перезаписывает. Если файла нет, удалённый шаг завершается с текстом `Missing /home/deploy/qa_test/backend/.env on the server`.

Юнит systemd и сайт nginx — в разделах ниже. Их тоже создают до первого деплоя.

## Переменные .env

Имена ниже — те, что заданы в `backend/.env.example`. Значения-секреты (`AIO_TOKEN`, `TL_PASSWORD`, `DEEPSEEK_API_KEY`, `AI_API_KEY`, пароль в `DATABASE_URL`) пишут только на сервере.

Для этого VPS workflow подразумевает такие продуктовые значения:

```bash
PORT=3000
PUBLIC_BASE_URL=http://bdc-it.uk:3000
FRONTEND_ORIGIN=http://bdc-it.uk
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=verify-full
```

- `PORT` совпадает с портом в `API_BASE_URL` (по умолчанию 3000). Браузер ходит на `http://bdc-it.uk:3000` напрямую. nginx этот порт не проксирует, порт должен оставаться открытым.
- `PUBLIC_BASE_URL` — публичный origin API без завершающего слэша (`http://bdc-it.uk:3000`). Им собираются временные URL стенда.
- `FRONTEND_ORIGIN` — origin статики nginx без завершающего слэша (`http://bdc-it.uk`). Несколько origin перечисляют через запятую.
- `DATABASE_URL` — строка Neon с `sslmode=verify-full`. Берут pooled-хост. Если в строке есть `channel_binding=require`, этот параметр убирают. Локальный Postgres из `docker-compose.yml` сюда не подставляют. Пустой `DATABASE_URL` при `STORAGE=neon` не даёт процессу стартовать.

Остальные переменные примера и рабочие значения для этого сервера:

| Переменная | Значение на этом VPS |
| --- | --- |
| `STORAGE` | `neon` |
| `AIO_TOKEN` | сервисный токен AIO |
| `TL_LOGIN` | логин первого тимлида |
| `TL_PASSWORD` | пароль первого тимлида (в базу не копируется) |
| `WORK_DIR` | `./data/workdir` (каталог относительно `/home/deploy/qa_test/backend`; процесс может писать на диск) |
| `AIO_BASE_URL` | `https://app.aio.tech`, если не нужен другой origin |
| `AIO_STORAGE_HOSTS` | хосты архивов через запятую; пусто, пока не заданы |
| `AIO_PREVIEW_CAMPAIGN_UUID` | UUID или пусто |
| `AIO_PREVIEW_SOURCE_UUID` | UUID или пусто |
| `AIO_PREVIEW_DOMAIN_UUID` | UUID или пусто |
| `AIO_TENANT_ID` | пусто, если заголовок не нужен |
| `STAND_FORM_HTML` | значение по умолчанию из `.env.example`; для systemd заключить в двойные кавычки, внутри них кавычки экранировать |
| `STAND_BRAND_NAME` | `Brand` или своё имя |
| `STAND_CDN_BASE` | пусто — origin превью этой проверки |
| `CATALOG_AUTO_REFRESH` | `1` |
| `AIO_NOTIFY_POLL_MS` | `2000` |
| `AIO_NOTIFY_POLLS_PER_ATTEMPT` | `5` |
| `AI_MODE` | `stub`, пока нет живого ключа |
| `DEEPSEEK_API_KEY` | ключ или пусто при `AI_MODE=stub` |
| `AI_API_KEY` | запасной ключ, если `DEEPSEEK_API_KEY` пуст |
| `AI_MODEL` | `deepseek-flash` |
| `LIGHTHOUSE_MODE` | `stub` |
| `LIGHTHOUSE_CHROME_PATH` | пусто |
| `VISUAL_MODE` | `stub` |
| `VISUAL_CHROME_PATH` | пусто |
| `BCRYPT_ROUNDS` | `10` |

В примере `AI_BASE_URL` только в комментарии (`https://api.deepseek.com` по умолчанию в коде). Раскомментируют его, если нужен другой origin.

`LIGHTHOUSE_MODE=real` и `VISUAL_MODE=real` требуют Chrome на сервере. Workflow Chrome не ставит. Пока Chrome нет, оба режима оставляют `stub`.

Процесс сам читает `.env` из рабочей директории и не затирает переменные, которые уже пришли из окружения. Юнит дополнительно передаёт тот же файл через `EnvironmentFile`. У `STAND_FORM_HTML` есть пробелы: в файле для systemd значение берут в двойные кавычки, иначе `systemd` может отказаться загрузить юнит.

## Юнит systemd qa-backend

Linger нужен, чтобы пользовательская шина жила без интерактивного входа. Workflow ищет сокет `/run/user/$(id -u)/bus` и при его отсутствии просит выполнить `sudo loginctl enable-linger deploy`.

```bash
sudo loginctl enable-linger deploy
sudo systemctl start "user@$(id -u deploy).service"
```

Юнит лежит у пользователя `deploy`: `/home/deploy/.config/systemd/user/qa-backend.service`.

```bash
sudo -u deploy mkdir -p /home/deploy/.config/systemd/user
sudo -u deploy tee /home/deploy/.config/systemd/user/qa-backend.service >/dev/null <<'EOF'
[Unit]
Description=QA Assistant API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/deploy/qa_test/backend
EnvironmentFile=/home/deploy/qa_test/backend/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
```

Включение от пользователя `deploy` (через `ssh deploy@206.188.197.105`):

```bash
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
systemctl --user daemon-reload
systemctl --user enable qa-backend
```

Первый `systemctl --user enable --now qa-backend` (и любой `start`) может завершиться ошибкой, пока нет `/home/deploy/qa_test/backend/dist/main.js`. До первой успешной выкладки достаточно `enable` без `--now`. После неё workflow сам делает `systemctl --user restart qa-backend` и проверяет `is-active`.

Workflow юнит не создаёт и `daemon-reload` не вызывает. Файл юнита на сервере правят вручную.

## Конфигурация nginx

nginx слушает 80 и отдаёт каталог фронтенда. Запросы к API на порт 3000 он не проксирует: в workflow прокси нет.

```bash
sudo tee /etc/nginx/sites-available/qa_test >/dev/null <<'EOF'
server {
    listen 80;
    # A-запись bdc-it.uk должна указывать на 206.188.197.105
    server_name bdc-it.uk;
    root /home/deploy/qa_test/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/qa_test /etc/nginx/sites-enabled/qa_test
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx
```

`try_files` отдаёт `index.html` для маршрутов SPA. После `rsync` файлы принадлежат `deploy` и должны читаться `www-data` (каталоги `755`, файлы `644`). Если главная открывается с 403:

```bash
sudo chmod 755 /home/deploy /home/deploy/qa_test /home/deploy/qa_test/frontend
sudo chmod -R a+rX /home/deploy/qa_test/frontend
```

## Проверка SSH и условий workflow

С машины, где лежит приватный ключ (порт заменить, если задан `SSH_PORT`):

```bash
ssh-keyscan -p 22 -T 15 206.188.197.105
ssh -i github-actions-deploy -p 22 -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 deploy@206.188.197.105 'echo ok'
```

`ssh-keyscan` должен напечатать хотя бы одну строку host key. Пустой ответ на runner роняет шаг «Record server host key». `BatchMode=yes` не задаёт вопросов про пароль: вход только по ключу.

Проверки, которые удалённый скрипт выполняет перед `restart`:

```bash
ssh -p 22 -o BatchMode=yes -o ConnectTimeout=20 deploy@206.188.197.105 'bash -s' <<'EOF'
set -euo pipefail
deploy_path=/home/deploy/qa_test
test -x /usr/bin/node
/usr/bin/node -v
test -f "$deploy_path/backend/.env"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
test -S "${XDG_RUNTIME_DIR}/bus"
systemctl --user is-active qa-backend
systemctl --user --no-pager --lines=20 status qa-backend
EOF
```

До первого деплоя обязаны проходить бинарник `/usr/bin/node`, файл `.env` и сокет шины. `is-active` станет успешным после того, как на сервере появится `dist/main.js` и юнит поднимется. Отсутствие сокета чинится командой `sudo loginctl enable-linger deploy` и стартом `user@UID.service`.

Ручной запуск того же workflow: Actions → Build and deploy → Run workflow, ветка `main`. Либо push в `main`.

После выкладки:

- `systemctl --user is-active qa-backend` печатает `active`;
- `curl -fsS http://bdc-it.uk:3000/` отвечает (код приложения, в том числе 404 на корне, уже значит, что порт слушается);
- `curl -fsS http://bdc-it.uk/` отдаёт `index.html` Angular.

Журнал API: `journalctl --user -u qa-backend -n 80 --no-pager`.

## Что обновляет деплой

На каждый успешный прогон workflow заменяет только собранный релиз.

Обновляется:

- `/home/deploy/qa_test/backend/dist/` — `rsync -az --delete` с каталога `dist` артефакта;
- `/home/deploy/qa_test/backend/package.json`;
- `/home/deploy/qa_test/backend/package-lock.json`;
- зависимости продакшена: в `/home/deploy/qa_test/backend` выполняется `npm ci --omit=dev` (каталог `node_modules` пересобирается из lock-файла);
- `/home/deploy/qa_test/frontend/` — `rsync -az --delete`, в каталоге остаётся только новый browser-билд.

Не изменяется:

- `/home/deploy/qa_test/backend/.env`;
- юнит `qa-backend` и конфигурация nginx;
- `docker-compose.yml` и локальный Postgres (их на сервере нет в составе выкладки);
- исходники TypeScript и Angular (на сервер они не копируются).

Секреты остаются только в серверном `.env` и в GitHub Actions. Повторный деплой их не затирает.
