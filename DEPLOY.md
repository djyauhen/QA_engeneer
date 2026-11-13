# Деплой QA Assistant

Продакшен выкладывает workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) («Build and deploy»). Сборка идёт на GitHub Actions. На сервер по SSH попадает уже собранный Nest (`node dist/main.js`) и статика Angular. nginx терминирует TLS и отдаёт сайт. API слушает только `127.0.0.1:3000`. Снаружи порта 3000 нет: браузер ходит на `https://bdc-it.uk`.

[`docker-compose.yml`](docker-compose.yml) поднимает локальный Postgres 16 для разработки (контейнер `qa-postgres`, порт `127.0.0.1:5432`). Workflow его не копирует и не запускает. Продуктовая база задаётся только `DATABASE_URL` в серверном `.env`.

## Что делает workflow

Запуск: push в ветку `main` и ручной `workflow_dispatch`. Одновременно выполняется одна выкладка (`concurrency.group: vps-deploy`, `cancel-in-progress: false`): следующая ждёт окончания текущей.

Job `build` (ubuntu-latest, Node.js 22, npm 11.19.0 через Corepack):

1. `backend`: `npm ci`, `npm test`, `npm run build`. Сборка обязана оставить `backend/dist/main.js`.
2. `frontend`: переменная `API_BASE_URL` обязана быть `https://` без завершающего слэша и без порта 3000. Дальше `npm ci`, `npm test`, `node scripts/apply-api-base.mjs`, `npm run build`. Сборка обязана оставить `frontend/dist/qa-assistant/browser/index.html`.
3. В артефакт `release` (хранится 1 день) попадают `backend/package.json`, `backend/package-lock.json`, `backend/dist`, содержимое `frontend/dist/qa-assistant/browser/` и каталог `deploy/` (`edge.sh`, конфиг nginx).

Job `deploy` скачивает артефакт, поднимает SSH-агент с секретом `SSH_PRIVATE_KEY`, записывает host key через `ssh-keyscan` и публикует релиз `rsync` по SSH. На сервере затем `npm ci --omit=dev`, `sudo -n deploy/edge.sh` (сертификат, nginx, firewall) и `systemctl --user restart qa-backend`. Через 3 секунды юнит должен быть в состоянии `active`.

Красный тест или отсутствующий `dist/main.js` / `index.html` останавливают выкладку до SSH.

## Хост, пользователь и пути

| | |
| --- | --- |
| Хост | `206.188.197.105` |
| Пользователь SSH | `deploy` |
| Каталог | `/home/deploy/qa_test` |
| Node | `/usr/bin/node` (Node.js 22) |
| API | пользовательский юнит systemd `qa-backend`, только `127.0.0.1:3000` |
| Сайт и API | nginx, TLS на 443, редирект с 80, прокси API на `127.0.0.1:3000` |
| Статика | корень `/home/deploy/qa_test/frontend` |
| SSH-порт | 22, если секрет `SSH_PORT` не задан |

Публичный сайт и публичный API: `https://bdc-it.uk` (без порта и без завершающего слэша). Порт 3000 с интернета не открывается.

Браузер открывает `https://bdc-it.uk/` и вызывает тот же origin (`/session`, `/catalog`, `/checks`, `/reports`, `/admin`, `/health`, `/preview`). nginx проксирует эти префиксы на loopback. `API_BASE_URL` вшивается в сборку фронтенда: смена адреса требует новой сборки, а не правки уже выложенных файлов.

## Секреты и переменные GitHub

Репозиторий → Settings → Secrets and variables → Actions.

Обязательный секрет:

- `SSH_PRIVATE_KEY` — приватный ключ OpenSSH целиком, вместе со строками `BEGIN` и `END`. Этим ключом runner входит как `deploy`.

Необязательный секрет:

- `SSH_PORT` — порт SSH, если он отличается от 22. Пустое значение означает порт 22.

Необязательная переменная репозитория (Variables, не Secrets):

- `API_BASE_URL` — публичный origin API без завершающего слэша. По умолчанию `https://bdc-it.uk`. Значение `http://` или с портом `3000` останавливает сборку. Оно вшивается в статику фронтенда на шаге `scripts/apply-api-base.mjs`. Смена адреса требует новой сборки. Это не переменная серверного `.env`. Если в Variables уже лежит старый `http://bdc-it.uk:3000`, замените его до следующего деплоя: workflow берёт переменную, а не дефолт из файла.

Пароли, строки `DATABASE_URL` и приватные ключи в git не кладутся. В `authorized_keys` на сервере лежит только публичная строка, например `ssh-ed25519 AAAA... github-actions-deploy`.

## Одноразовая настройка сервера

Команды ниже рассчитаны на Debian/Ubuntu. Их выполняют один раз до первого зелёного workflow. Репозиторий на сервер клонировать не нужно: код приезжает только как артефакт `rsync`.

### DNS

У регистратора создают A-запись `bdc-it.uk` → `206.188.197.105`. Пока она не указывает на этот IP, `https://bdc-it.uk/` снаружи не откроется и Let's Encrypt не выпустит сертификат. Команды SSH (`ssh`, `scp`, `ssh-keyscan`) по-прежнему используют `206.188.197.105`, не домен.

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
sudo apt-get install -y rsync nginx certbot ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
test -x /usr/bin/node
/usr/bin/node -v
npm -v
```

`/usr/bin/node` должен быть Node.js 22. Workflow вызывает именно этот путь и затем `npm ci --omit=dev` от пользователя `deploy`. `npm` обязан быть в `PATH` этого пользователя (`/usr/bin/npm`).

Открытые порты: SSH (22 или значение `SSH_PORT`), 80 (только редирект на HTTPS и проверка Let's Encrypt) и 443. Порт 3000 снаружи закрыт: его слушает только `127.0.0.1`. Если firewall уже включён:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw delete allow 3000/tcp || true
sudo ufw deny 3000/tcp
```

Тот же набор правил заново применяет `deploy/edge.sh` на каждом деплое. Включать ufw самим скриптом нельзя: неверный порт SSH отрежет вход. Если ufw выключен, правило «deny 3000» только сохраняется. Снаружи порт всё равно молчит, потому что Node не слушает внешний интерфейс.

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

Юнит systemd создают до первого деплоя. Сайт nginx и сертификат ставит `deploy/edge.sh` уже во время деплоя. До этого у пользователя `deploy` должен быть passwordless sudo на этот скрипт, иначе выкладка остановится и API не перезапустится.

## Переменные .env

Имена ниже — те, что заданы в `backend/.env.example`. Значения-секреты (`AIO_TOKEN`, `TL_PASSWORD`, `DEEPSEEK_API_KEY`, `AI_API_KEY`, пароль в `DATABASE_URL`) пишут только на сервере.

Для этого VPS workflow подразумевает такие продуктовые значения:

```bash
PORT=3000
LISTEN_HOST=127.0.0.1
PUBLIC_BASE_URL=https://bdc-it.uk
FRONTEND_ORIGIN=https://bdc-it.uk
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=verify-full
```

- `LISTEN_HOST` — только `127.0.0.1`. Так процесс не принимает соединения из интернета. Другое значение не даёт ему стартовать.
- `PORT` — порт loopback, на который смотрит nginx (`127.0.0.1:3000`). В браузерный `API_BASE_URL` этот порт не входит.
- `PUBLIC_BASE_URL` — публичный origin без порта и без завершающего слэша (`https://bdc-it.uk`). Им собираются временные URL стенда (`/preview/...`).
- `FRONTEND_ORIGIN` — тот же origin статики (`https://bdc-it.uk`). Несколько origin перечисляют через запятую.
- `DATABASE_URL` — строка Neon с `sslmode=verify-full`. Берут pooled-хост. Если в строке есть `channel_binding=require`, этот параметр убирают. Локальный Postgres из `docker-compose.yml` сюда не подставляют. Пустой `DATABASE_URL` при `STORAGE=neon` не даёт процессу стартовать.

Workflow файл `.env` не перезаписывает. Уже выложенный сервер нужно поправить вручную: `PUBLIC_BASE_URL` и `FRONTEND_ORIGIN` должны стать `https://bdc-it.uk`, иначе ссылки стенда останутся на старом `http://…:3000`.

Остальные переменные примера и рабочие значения для этого сервера:

| Переменная | Значение на этом VPS |
| --- | --- |
| `LISTEN_HOST` | `127.0.0.1` |
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
| `AI_MODEL` | `deepseek-v4-pro` |
| `LIGHTHOUSE_MODE` | `stub` |
| `LIGHTHOUSE_CHROME_PATH` | пусто |
| `VISUAL_MODE` | `stub` |
| `VISUAL_CHROME_PATH` | пусто |
| `BCRYPT_ROUNDS` | `10` |
| `FINGERPRINT_KEY` | секрет HMAC, не пароль тимлида |

`LIGHTHOUSE_MODE=real` и `VISUAL_MODE=real` запускают локальный бинарь Lighthouse из `node_modules` и Chrome. Путь задают `LIGHTHOUSE_CHROME_PATH`, `VISUAL_CHROME_PATH` или общий `CHROME_PATH`. На Linux без пути шаг падает с текстом «Chrome не найден», а не остаётся тихим stub. Пока Chrome нет, оба режима оставляют `stub`. Для запуска Chrome без песочницы на Linux: `LIGHTHOUSE_NO_SANDBOX=1`. Workflow Chrome не ставит.

В примере `AI_BASE_URL` только в комментарии (`https://api.deepseek.com` по умолчанию в коде). Раскомментируют его, если нужен другой origin.

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

## Конфигурация nginx и сертификат

Сайт и API открываются по `https://bdc-it.uk`. Порт 80 только принимает вызов Let's Encrypt и редиректит остальное на HTTPS. Порт 443 отдаёт статику и проксирует `/session`, `/catalog`, `/checks`, `/reports`, `/admin`, `/health` и `/preview` на `http://127.0.0.1:3000`. Заголовок `X-Forwarded-Proto` ставит nginx. Node доверяет ему только от loopback.

Конфиг в репозитории: [`deploy/nginx/qa_test.conf`](deploy/nginx/qa_test.conf) и [`deploy/nginx/qa_api_proxy.conf`](deploy/nginx/qa_api_proxy.conf). Приватные ключи в git не кладутся. Они появляются на сервере в `/etc/letsencrypt/live/bdc-it.uk/`.

Один раз, до первого деплоя с этим скриптом, `deploy` должен иметь право запускать только его:

```bash
echo 'deploy ALL=(root) NOPASSWD: /home/deploy/qa_test/deploy/edge.sh' | sudo tee /etc/sudoers.d/qa-edge
sudo chmod 440 /etc/sudoers.d/qa-edge
sudo visudo -cf /etc/sudoers.d/qa-edge
```

Дальше каждый деплой сам вызывает `sudo -n /home/deploy/qa_test/deploy/edge.sh`. Скрипт идемпотентный:

- ставит `nginx` и `certbot`, если их ещё нет;
- если нет `/etc/letsencrypt/live/bdc-it.uk/fullchain.pem`, поднимает временный сайт на порту 80 и один раз вызывает `certbot certonly --webroot`. Повторный деплой certbot не запускает;
- почту берёт из `CERTBOT_EMAIL` в серверном `.env`, если строка есть. Остальное содержимое `.env` не печатает. Без почты выпуск идёт с `--register-unsafely-without-email`;
- копирует боевой конфиг nginx, делает `nginx -t` и reload;
- один раз кладёт хук обновления `/etc/letsencrypt/renewal-hooks/deploy/qa-reload-nginx.sh`, который только перезагружает nginx. Сам сертификат продлевает таймер пакета `certbot.timer`, не деплой;
- снимает у ufw разрешение на `3000/tcp` и добавляет запрет. `ufw enable` не делает.

Ручной прогон того же шага, если workflow ещё не запускали:

```bash
sudo bash /home/deploy/qa_test/deploy/edge.sh
```

Пока сертификата нет, A-запись уже должна указывать на этот сервер, иначе certbot завершится ошибкой и workflow не перезапустит API.

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
- `curl -fsS http://127.0.0.1:3000/health` на сервере отвечает `{"ok":true}` (порт берётся из `PORT` в `.env`, если он не 3000). Снаружи то же самое: `curl -fsS https://bdc-it.uk/health`. Недоступная база даёт не 200, без строки подключения в ответе;
- `ss -ltnp` на сервере показывает `127.0.0.1:3000`, не `0.0.0.0:3000`;
- `curl -fsS https://bdc-it.uk/` отдаёт `index.html` Angular;
- `curl -s -o /dev/null -w '%{http_code}\n' https://bdc-it.uk/session` отвечает кодом приложения (без сессии это 401), а не обрывом соединения;
- с другой машины `curl --connect-timeout 5 http://bdc-it.uk:3000/` не подключается;
- `curl -sI http://bdc-it.uk/` показывает редирект на `https://bdc-it.uk/`.

Журнал API: `journalctl --user -u qa-backend -n 80 --no-pager`.

## Что обновляет деплой

На каждый успешный прогон workflow заменяет только собранный релиз.

Обновляется:

- `/home/deploy/qa_test/backend/dist/` — `rsync -az --delete` с каталога `dist` артефакта;
- `/home/deploy/qa_test/backend/package.json`;
- `/home/deploy/qa_test/backend/package-lock.json`;
- зависимости продакшена: в `/home/deploy/qa_test/backend` выполняется `npm ci --omit=dev` (каталог `node_modules` пересобирается из lock-файла);
- `/home/deploy/qa_test/frontend/` — `rsync -az --delete`, в каталоге остаётся только новый browser-билд;
- `/home/deploy/qa_test/deploy/` — `edge.sh` и конфиг nginx из артефакта;
- сайт nginx, сертификат (только если его ещё не было) и правила ufw для порта 3000 — через `sudo -n deploy/edge.sh`.

Не изменяется:

- `/home/deploy/qa_test/backend/.env` (в том числе `PUBLIC_BASE_URL` и `FRONTEND_ORIGIN`: их правят на сервере вручную);
- юнит `qa-backend`;
- уже выпущенный сертификат Let's Encrypt (повторный `certbot certonly` не вызывается);
- `docker-compose.yml` и локальный Postgres (их на сервере нет в составе выкладки);
- исходники TypeScript и Angular (на сервер они не копируются).

Секреты остаются только в серверном `.env` и в GitHub Actions. Повторный деплой их не затирает.
