1. Запускать могут: ТЛ (самый высокий уровень доступа с возможностью просмотра статистики (затраты на модели) и всех отчетов по лендам любого пользователя); QA (имеет уровень доступа чуть ниже - может запускать полный спектр проверок, но не видит статистики; видит только свои отчеты); 
2. Отчет только подсказка - решение всегда принимает сам пользователь
3. до 10 человек
4. Язык отчета русский, но ледны могут быть на совершенно разных языках.
5. Вот что есть о ленде - мы будем вводить `human_id`
```
"_identity": {
                        "uuid": "b5959d7a-3506-4fef-b90b-3889f58ad50e",
                        "name": "CA_en|ODRI|GovProgram|gouvernement du canada|Mark Carney|250$|Vb_\u041d\u0415 \u0417\u0410\u041b\u0418\u0412\u0410\u0422\u042c",
                        "quality_json": [],
                        "human_id": "359226",
                        "mvt_settings": "[{\"key\": \"title\", \"uuid\": \"5560dc3c-fc7e-4595-b128-ea5062a7cbd6\", \"settings\": {\"items\": [{\"payload\": {\"type\": \"Text\", \"uuid\": \"fff485c6-64f8-4247-a2d0-28eacaee236d\", \"group\": \"Rainbow\", \"weight\": 100, \"content\": \"Prime Minister Mark Carney confirms: Canadians who paid taxes can now reclaim up to $20,000 through a government-backed refund\", \"rewards\": 0, \"isActive\": true, \"selected\": 1, \"isFillFirst\": false}, \"conditions\": [], \"scope_type\": \"Landing\", \"scope_uuid\": \"b5959d7a-3506-4fef-b90b-3889f58ad50e\", \"lp_split_mode\": \"Landing\"}], \"reset-ml\": false, \"optimize-event\": \"any\", \"optimize-metric\": null, \"select-strategy\": \"Weights\", \"optimize-timeframe\": \"Last 24 Hours\", \"field-values-amount\": 1}, \"availablePayloads\": [\"Text\"]}, {\"key\": \"bannerUrl\", \"uuid\": \"2205e3bb-9a2b-4d19-974a-e5026b204105\", \"settings\": {\"items\": [{\"payload\": {\"type\": \"Image\", \"uuid\": \"2d939323-ec51-4075-940e-57516655998e\", \"group\": \"Rainbow\", \"weight\": 100, \"content\": \"https:\/\/aio-tech.ams3.digitaloceanspaces.com\/production\/landing-cdn\/65b5f05e-9fc2-4440-beea-9cbe16c3874d\/b5959d7a-3506-4fef-b90b-3889f58ad50e\/images\/p11.webp\", \"rewards\": 0, \"isActive\": true, \"selected\": 1, \"isFillFirst\": false}, \"conditions\": [], \"scope_type\": \"Landing\", \"scope_uuid\": \"b5959d7a-3506-4fef-b90b-3889f58ad50e\", \"lp_split_mode\": \"Landing\"}], \"reset-ml\": false, \"optimize-event\": \"any\", \"optimize-metric\": null, \"select-strategy\": \"Weights\", \"optimize-timeframe\": \"Last 24 Hours\", \"field-values-amount\": 1}, \"availablePayloads\": [\"Image\"]}]",
                        "preview_image": "https:\/\/aio-tech.ams3.digitaloceanspaces.com\/production\/screenshots-cdn\/65b5f05e-9fc2-4440-beea-9cbe16c3874d\/lander-screenshot\/b5959d7a-3506-4fef-b90b-3889f58ad50e\/65b5f05e-9fc2-4440-beea-9cbe16c3874d-b5959d7a-3506-4fef-b90b-3889f58ad50e-1791389103.1285.webp",
                        "is_archived": false,
                        "is_copy": false,
                        "copied_from_uuid": null,
                        "is_muted": false,
                        "is_ai": false,
                        "status": "Fine",
                        "description": "",
                        "pages_mode": "Path",
                        "countries": [
                            "CA"
                        ],
                        "languages": [
                            "en"
                        ],
                        "status_text": "Everything is fine",
                        "lander_type_uuid": "2005c18d-c332-4b8c-9859-24f7adc8c758",
                        "mode": "Editor",
                        "created_at": "2026-10-07T16:00:23.000000Z",
                        "lander_type": {
                            "uuid": "2005c18d-c332-4b8c-9859-24f7adc8c758",
                            "is_auto_place_aio_macros": true,
                            "is_generate_events": true,
                            "is_full_cdn_used": true,
                            "temp_cdn": false,
                            "name": "Preland w\/ Form",
                            "icon": "atiIconBadgesBoldNotesDocumentText",
                            "color": "#313ffe",
                            "pwa_conversions": {
                                "install": null,
                                "open": null,
                                "subscribe": null
                            }
                        },
                        "lander_template": {
                            "uuid": "742f1df9-f307-4d87-a23d-aa6fd2328a2b",
                            "name": "Simple",
                            "preview_image": null,
                            "status_text": null,
                            "status": "Fine"
                        }
                    },
```
6. Я приложу запрос на скачивание, который имеется в сервисе:
а. При попытке получить ссылку на скачивание у нас есть такой запрос:
```
URL запроса
https://app.aio.tech/api/v1/actions/process
Метод запроса
POST
Код статуса
200 OK
Удаленный адрес
172.66.173.224:443
Правило для URL перехода
strict-origin-when-cross-origin
:authority
app.aio.tech
:method
POST
:path
/api/v1/actions/process
:scheme
https
accept
application/json, text/plain, */*
accept-encoding
gzip, deflate, br, zstd
accept-language
ru,en-US;q=0.9,en;q=0.8,es-CO;q=0.7,es;q=0.6,de;q=0.5,pl;q=0.4,fr;q=0.3,da;q=0.2
baggage
sentry-environment=production,sentry-release=0.9.00491,sentry-public_key=d0f433cfca5d03c12d363b27a22b9f50,sentry-trace_id=50dd3d2b66614029862a0154ff92aee1,sentry-sample_rate=1,sentry-sampled=true
content-length
518
content-type
multipart/form-data; boundary=----WebKitFormBoundaryQTRyP5tB39VTtIBv
cookie
token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vYXBwLmFpby50ZWNoL2FwaS92MS9hdXRoL2ltcGVyc29uYXRlL3N0b3AiLCJpYXQiOjE3OTA1OTU3NDgsImV4cCI6NTM5MDU5NTc0OCwibmJmIjoxNzkwNTk1NzQ4LCJqdGkiOiIzalh6RzYyWnBVN1BQZ1RYIiwic3ViIjoiMzYzNjg1NjAtNGY4OC00MTE2LWFiZjctMDg2OGMwODFhNTg0IiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyIsImltcGVyc29uYXRvcl91dWlkIjoiMzYzNjg1NjAtNGY4OC00MTE2LWFiZjctMDg2OGMwODFhNTg0IiwiaW1wZXJzb25hdGVkX3VudGlsIjoxNzkwNjAyOTA4LCJpbXBlcnNvbmF0ZWRfdGVuYW50IjoiNjViNWYwNWUtOWZjMi00NDQwLWJlZWEtOWNiZTE2YzM4NzRkIn0.kMxp6oN5l55HksMJihsUQIRq_h9Tc3GWi9MUpoVkL-E; ph_phc_mPNV5Q6m8QFnEP6Zt3ngNsWvghuBpmkram9pDieWGujA_posthog=%7B%22%24device_id%22%3A%2201a0ae67-0256-7eeb-b65f-967639bf6992%22%2C%22distinct_id%22%3A%2236368560-4f88-4116-abf7-0868c081a584%22%2C%22%24sesid%22%3A%5B1791391946545%2C%2201a11740-7bb9-7b40-b05e-790e7a9457d3%22%2C1791391464376%5D%2C%22%24epp%22%3Atrue%2C%22%24initial_person_info%22%3A%7B%22r%22%3A%22%24direct%22%2C%22u%22%3A%22https%3A%2F%2Fapp.aio.tech%2Fauth%2Flogin%22%7D%2C%22%24user_state%22%3A%22identified%22%7D
origin
https://app.aio.tech
priority
u=1, i
referer
https://app.aio.tech/app/landers-creatives/landers
sec-ch-ua
"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-origin
sentry-trace
50dd3d2b66614029862a0154ff92aee1-aeb8c56db138bcc7-1
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36
x-tenant-id
65b5f05e-9fc2-4440-beea-9cbe16c3874d
```
полезная нагрузка
```
action
Lander\Download
repository
Eloquent\LanderRepository
arguments[is_archived]
true
uuids[0]
139ad9fa-e4ca-4e65-8f37-c835ccf8fb94
```
ответ
```
{
    "messages": [
        {
            "type": 2,
            "title": "Actions Service",
            "message": "Download Requested",
            "data": null
        }
    ],
    "primary": "139ad9fa-e4ca-4e65-8f37-c835ccf8fb94",
    "uuid": "139ad9fa-e4ca-4e65-8f37-c835ccf8fb94"
}
```
b. Далее заходим в "уведомления" и там есть ссылка на скачивание.
запрос
```
URL запроса
https://app.aio.tech/api/v1/notifications?limit=25&page=1&unread_only=false
Метод запроса
GET
Код статуса
200 OK
Удаленный адрес
104.20.32.75:443
Правило для URL перехода
strict-origin-when-cross-origin
:authority
app.aio.tech
:method
GET
:path
/api/v1/notifications?limit=25&page=1&unread_only=false
:scheme
https
accept
application/json, text/plain, */*
accept-encoding
gzip, deflate, br, zstd
accept-language
ru,en-US;q=0.9,en;q=0.8,es-CO;q=0.7,es;q=0.6,de;q=0.5,pl;q=0.4,fr;q=0.3,da;q=0.2
baggage
sentry-environment=production,sentry-release=0.9.00491,sentry-public_key=d0f433cfca5d03c12d363b27a22b9f50,sentry-trace_id=50dd3d2b66614029862a0154ff92aee1,sentry-sample_rate=1,sentry-sampled=true
cookie
token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOi8vYXBwLmFpby50ZWNoL2FwaS92MS9hdXRoL2ltcGVyc29uYXRlL3N0b3AiLCJpYXQiOjE3OTA1OTU3NDgsImV4cCI6NTM5MDU5NTc0OCwibmJmIjoxNzkwNTk1NzQ4LCJqdGkiOiIzalh6RzYyWnBVN1BQZ1RYIiwic3ViIjoiMzYzNjg1NjAtNGY4OC00MTE2LWFiZjctMDg2OGMwODFhNTg0IiwicHJ2IjoiMjNiZDVjODk0OWY2MDBhZGIzOWU3MDFjNDAwODcyZGI3YTU5NzZmNyIsImltcGVyc29uYXRvcl91dWlkIjoiMzYzNjg1NjAtNGY4OC00MTE2LWFiZjctMDg2OGMwODFhNTg0IiwiaW1wZXJzb25hdGVkX3VudGlsIjoxNzkwNjAyOTA4LCJpbXBlcnNvbmF0ZWRfdGVuYW50IjoiNjViNWYwNWUtOWZjMi00NDQwLWJlZWEtOWNiZTE2YzM4NzRkIn0.kMxp6oN5l55HksMJihsUQIRq_h9Tc3GWi9MUpoVkL-E; ph_phc_mPNV5Q6m8QFnEP6Zt3ngNsWvghuBpmkram9pDieWGujA_posthog=%7B%22%24device_id%22%3A%2201a0ae67-0256-7eeb-b65f-967639bf6992%22%2C%22distinct_id%22%3A%2236368560-4f88-4116-abf7-0868c081a584%22%2C%22%24sesid%22%3A%5B1791392142662%2C%2201a11740-7bb9-7b40-b05e-790e7a9457d3%22%2C1791391464376%5D%2C%22%24epp%22%3Atrue%2C%22%24initial_person_info%22%3A%7B%22r%22%3A%22%24direct%22%2C%22u%22%3A%22https%3A%2F%2Fapp.aio.tech%2Fauth%2Flogin%22%7D%2C%22%24user_state%22%3A%22identified%22%7D
priority
u=1, i
referer
https://app.aio.tech/app/landers-creatives/landers
sec-ch-ua
"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"
sec-ch-ua-mobile
?0
sec-ch-ua-platform
"Windows"
sec-fetch-dest
empty
sec-fetch-mode
cors
sec-fetch-site
same-origin
sentry-trace
50dd3d2b66614029862a0154ff92aee1-aeb8c56db138bcc7-1
user-agent
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36
x-tenant-id
65b5f05e-9fc2-4440-beea-9cbe16c3874d
```
нагрузка
```
limit
25
page
1
unread_only
false
```
ответ
```
{
    "data": {
        "current_page": 1,
        "data": [
            {
                "uuid": "cdb25d0a-6f9b-4654-aa4d-3e215d38e632",
                "notification_uuid": "93219d0f-4761-4b6c-87dc-9afc8f55ca43",
                "user_uuid": "36368560-4f88-4116-abf7-0868c081a584",
                "tenant_uuid": "65b5f05e-9fc2-4440-beea-9cbe16c3874d",
                "read_at": null,
                "created_at": "2026-10-07T16:52:28.000000Z",
                "updated_at": "2026-10-07T16:52:28.000000Z",
                "notification": {
                    "uuid": "93219d0f-4761-4b6c-87dc-9afc8f55ca43",
                    "tenant_uuid": "65b5f05e-9fc2-4440-beea-9cbe16c3874d",
                    "type": "lander.download",
                    "severity": "success",
                    "title": "Landing export is ready: MultyTHKOVEKYod-ChinsupakulthethaigerEN(TEMPL1)250$\u041d\u0415 \u0417\u0410\u041b\u0418\u0412\u0410\u0422\u042c",
                    "body": "ready to download",
                    "payload": {
                        "files": [
                            {
                                "url": "https:\/\/app.aio.tech\/api\/v1\/storage\/download?disk=digitalocean&expires=1791996754&key=production%2Flanding-exports%2F36368560-4f88-4116-abf7-0868c081a584%2F65b5f05e-9fc2-4440-beea-9cbe16c3874d%2F139ad9fa-e4ca-4e65-8f37-c835ccf8fb94%2Fmulty-th-kov-ek-yod-chinsupakul-thethaiger-en--templ1--250--ne-zalivat--65b5f05e-9fc2-4440-beea-9cbe16c3874d-139ad9fa-e4ca-4e65-8f37-c835ccf8fb94-b52e9d356e61e01409094ba0acf73138.zip&ngsw-bypass=true&signature=6d3600d25f829e9d0beface0877a8aeecdadf8307ba981ffd94ae3fabb5c10a4",
                                "kind": "merged",
                                "label": "Merged export",
                                "description": "Landing with all the current AIO changes is ready to download."
                            },
                            {
                                "url": "https:\/\/app.aio.tech\/api\/v1\/storage\/download?disk=digitalocean&expires=1791996754&key=production%2Faction-files%2F65b5f05e-9fc2-4440-beea-9cbe16c3874d%2Faa81ef04-0d72-45a6-8d0d-452897aa91ff%2F2026-10-07%2Fa89b67c5-243a-4112-a1fe-99b5f0969757.zip&ngsw-bypass=true&signature=19fe9928163ff20feb3f3ba825606276064185879c0a4c4f6a781a9b5199e122",
                                "kind": "original",
                                "label": "Original upload",
                                "description": "The original archive from which the landing was uploaded."
                            }
                        ],
                        "status": "done",
                        "message": null,
                        "percent": 100,
                        "human_id": "359224",
                        "lander_name": "Multy_TH_KOV_EK_Yod-Chinsupakul_thethaiger_EN_(TEMPL1)_250$_\u041d\u0415 \u0417\u0410\u041b\u0418\u0412\u0410\u0422\u042c",
                        "lander_uuid": "139ad9fa-e4ca-4e65-8f37-c835ccf8fb94",
                        "tenant_name": "C2R",
                        "link_ttl_days": 7
                    },
                    "rule_uuid": null,
                    "created_by": "36368560-4f88-4116-abf7-0868c081a584",
                    "audience": {
                        "type": "users",
                        "user_uuids": [
                            "36368560-4f88-4116-abf7-0868c081a584"
                        ]
                    },
                    "created_at": "2026-10-07T16:52:28.000000Z",
                    "updated_at": "2026-10-07T16:52:34.000000Z"
                }
            },
        ]
    }
}
```
7. Есть токен - я его приложу в .env
8. ответил в вопросе 6
9. Архив имеет в своем составе следующее: index.html(.php); папки css, js, images. Пример архива D:\WORK_EPC\TeamLeader\QA_test\docs\multy_th_kov_ek_yod-chinsupakul_thethaiger_en_-templ1-_250-_-.zip
10. Может быть преленд, ленд, оффер - они имеют одинаковую структуру, но отличается только наличие формы (скрипт или макрос)
11. Проверки можно посмотреть в проекте D:\WORK_EPC\TeamLeader\SpyOwlUnified. Так же добавляется проверка через ИИ для текста, применения изображений
12. Проверки можно посмотреть в проекте D:\WORK_EPC\TeamLeader\SpyOwlUnified
13. Проверки можно посмотреть в проекте D:\WORK_EPC\TeamLeader\SpyOwlUnified
14. Сначала проверяем скрипты, структуру, файлы. Если есть критические моменты в ИИ не уходим самостоятельно - спрашиваем у пользователя.
15. Проверки можно посмотреть в проекте D:\WORK_EPC\TeamLeader\SpyOwlUnified
16. Мы должны иметь возможность посмотреть сам ленд (много макросов которые нужно подставлять). Пример реализации есть в D:\WORK_EPC\TeamLeader\SpyOwlUnified
17. Ленды нужно изолировать, но после полной проверки и создании отчета его можно удалить. Так же каталог удаляется при смене ленда. Т.е. один пользователь может проверять только один ленд одновременно
18. Давай делать временную ссылку при возможности.
19. Сам ленд ничего не делает самостоятельно (без разрешения QA). 
20. Проверка может быть последовательно-параллельной, т.е. первая часть (структура, скрипты, вес и т.п.) может быть параллельно, а вот к ИИ переходим только после полной проверки первой части (если нет критических ошибок) или с разрешения пользователя
21. Может видеть всё вместе.
22. Языки могут быть разные. В ответе на запрос перед скачиванием мы получаем страну и язык. Ошибками считаются: орфография, смешение языков, смысл некоторых фраз, наличие имен не характерных данному ГЕО, валюта для данного ГЕО
23. Дубль там где макет требует уникального значения. Например, одинаковое фото для разных комментаторов. Имеется одно и то же фото в основном контенте ленда.
24. ИИ выдает список недостатков, но сам не принимает решение о блоке
25. Думал попробовать модель QWEN, ограничений пока нет
26. Готовый разбор: отчет по пунктам первого блока и второй блок (ИИ) в виде текста в отдельном блоке на странице
27. Без общего статуса. Статусы у каждой части свои: отдельно ИИ и отдельно структура/размеры/скрипты
28. Обязательно доказательства, особенно по ИИ: путь к файлу, цитата текста, скриншот
29. Отчет хранится в течении 3-х месяцев. Есть возможость открыть отчет прошлый и сравнить с текущим.
30. Нет количества лендов в день. Давай время ожидания - 2-3 минуты (нужно использовать быстрые модели)
31. Повторяем автоматически 3 раза, далее - ошибка при проверке
32. Отдельный конфиг у админа
33. Все шаги необходимы
34. Никуда не отправляем
35. Ничего нет
36. Сравниваем с Lighthouse
37. Я буду принимать решение