# -*- coding: utf-8 -*-
"""Generate design/design.pen — Pencil 2.20 (schema of the installed editor). Internal QA assistant mock."""
import json
import sys
from pathlib import Path

OUT = Path(__file__).with_name("design.pen")

S = {
    "login": "Войти",
    "user": "Логин",
    "pass": "Пароль",
    "bad_login": "Неверный логин или пароль.",
    "users": "Пользователи",
    "env": "Задана окружением",
    "dup": "Такой логин уже есть.",
    "as_tl": "Вы вошли как ТЛ",
    "as_qa": "Вы вошли как QA",
    "refresh": "Обновить",
    "search": "Поиск",
    "empty_cat": "В каталоге нет лендов.",
    "empty_search": "Ничего не найдено.",
    "start": "Запустить проверку",
    "miss": "Этого human_id нет среди последних 300 лендов. Скачивание не начато.",
    "collision": "Несколько записей с одним human_id. Выбор не делается. Скачивание не начато.",
    "retry": "Идёт повтор",
    "part": "Ошибка этой части",
    "replaced": "Предыдущий просмотр этого пользователя заменён.",
    "allow_ai": "Разрешить ИИ",
    "deny_ai": "Не разрешать ИИ",
    "fork": "Есть критичные находки статики (failed). ИИ сам не стартовал.",
    "structure": "Проверка структуры не пройдена. Остальные статические пункты не запускались.",
    "disclaimer": "Отчёт рекомендательный. Решение принимаете вы.",
    "st_failed": "есть failed",
    "st_warn": "только warning",
    "st_ok": "все passed",
    "st_broke": "проверка не завершилась",
    "ai_ready": "Список готов",
    "ai_wait": "не запускался (ждут решения пользователя)",
    "ai_err": "ошибка после повторов",
    "lh_ok": "Выполнен",
    "lh_err": "Ошибка прогона",
    "no_prev": "Прошлого отчёта этого human_id нет.",
    "temp": "Временный адрес. В отчёт он не сохраняется.",
    "iso": "Ленд сам ничего не выполняет: нет отправки лидов и нет сторонних пикселей.",
    "allow_land": "Разрешить действия ленда",
    "preview": "Превью каталога. Это не скриншот стенда.",
    "cat_status": "Статус в каталоге. Это не вердикт проверки.",
    "no_usage": "Провайдер модели не вернул учёт использования.",
    "no_history": "История изменений не ведётся.",
    "save": "Сохранить",
    "create": "Создать",
    "langs_cap": "Пустое поле — брать языки ленда.",
    "not_from_type": "Не вычисляется из типа ленда.",
}

ORDER = [
    "Поиск в каталоге",
    "Запрос скачивания",
    "Ожидание уведомления",
    "Скачивание архива",
    "Распаковка",
    "Статические проверки",
    "Решение по ИИ",
    "Стенд",
    "ИИ",
    "Lighthouse",
    "Отчёт",
]

METRICS = [
    ("performance score", "64", "79"),
    ("First Contentful Paint", "1,8 с", "1,1 с"),
    ("Largest Contentful Paint", "3,4 с", "2,1 с"),
    ("Total Blocking Time", "210 мс", "40 мс"),
    ("Cumulative Layout Shift", "0,09", "0,02"),
    ("Speed Index", "3,6 с", "1,9 с"),
    ("Time to Interactive", "4,2 с", "2,5 с"),
]
METRICS_PREV = [
    ("performance score", "71", "84"),
    ("First Contentful Paint", "1,6 с", "1,0 с"),
    ("Largest Contentful Paint", "2,9 с", "1,8 с"),
    ("Total Blocking Time", "160 мс", "30 мс"),
    ("Cumulative Layout Shift", "0,06", "0,01"),
    ("Speed Index", "3,1 с", "1,6 с"),
    ("Time to Interactive", "3,8 с", "2,2 с"),
]

PREFIXES = [
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
    "https://code.jquery.com",
    "https://ajax.googleapis.com",
    "https://cdn.jsdelivr.net",
    "https://scripts.converteai.net",
    "https://images.converteai.net",
]

MACROS = ["{offer}", "{_offer_value:brand_name}", "{_fbclid}"]
SCRIPTS = [
    "object",
    "iframe",
    "form",
    "встроенный <script> без class, содержащего whitelist, длиннее 10 непустых строк",
]

ROWS = [
    ("359226", "Joint Relief", "07.10.2026 14:32"),
    ("359180", "Cardio Form", "06.10.2026 18:05"),
    ("358901", "Slim Tea", "05.10.2026 11:20"),
]
COLLIDE = [
    ("359226", "Joint Relief", "07.10.2026 14:32"),
    ("359226", "Joint Relief 2", "07.10.2026 09:14"),
    ("359180", "Cardio Form", "06.10.2026 18:05"),
]

Q_REFUSAL = (
    "Открытый вопрос: стенд и Lighthouse после отказа от ИИ исходное ТЗ не сводит в одну фразу. "
    "Шаги «Стенд» и «Lighthouse» здесь не идут. Отдельного статуса отказа нет, общий статус страницы не ставится."
)
Q_TL_BTN = (
    "Открытый вопрос: может ли ТЛ нажать «Разрешить действия ленда» на своём просмотре. "
    "Кнопка на макете есть, она не скрыта и не объявлена запретом."
)
Q_LANG = (
    "Открытый вопрос: ожидаемые языки заменяют метаданные ленда или дополняют их. Подпись поля этот режим не выбирает."
)
Q_URL = (
    "Открытый вопрос: отдельный текст, если среда не выдала временный URL, исходным ТЗ не задан. "
    "Постоянную ссылку и подписанный URL в отчёт не подставляем."
)
Q_LIVE = (
    "Открытый вопрос: живёт ли стенд после готового отчёта. Временный адрес в постоянный отчёт не кладётся."
)
Q_COST = (
    "Открытый вопрос: схема цифр провайдера не задана. Ниже образец пришедших чисел, без пересчёта в другую валюту и без прайса продукта."
)
Q_LISTS = (
    "Открытый вопрос: полные списки признаков «как в модуле» дословно не раскрыты. Выдуманные строки не добавлены — на экране только явно названное."
)
Q_LH = "Открытый вопрос: пороги Lighthouse не заданы и в макет не вводятся. У ячейки нет шкалы оценки балла."

_n = 0


def uid(prefix="n"):
    global _n
    _n += 1
    return f"{prefix}{_n}"


def T(i, content, size="$font.size.body", weight="400", fill="$color.text", growth="auto", **kw):
    node = {
        "id": i,
        "type": "text",
        "content": content,
        "fontFamily": kw.pop("fontFamily", "$font.family"),
        "fontSize": size,
        "fontWeight": weight,
        "fill": fill,
        "textGrowth": growth,
        "lineHeight": kw.pop("lineHeight", 1.35),
    }
    node.update(kw)
    return node


def F(i, children=None, layout="vertical", **kw):
    node = {"id": i, "type": "frame", "layout": layout, "children": children or []}
    node.update(kw)
    return node


def R(i, ref, **kw):
    node = {"id": i, "type": "ref", "ref": ref}
    node.update(kw)
    return node


def E(i, size, fill, stroke=None):
    node = {"id": i, "type": "ellipse", "width": size, "height": size, "fill": fill}
    if stroke:
        node["stroke"] = stroke
        node["strokeWidth"] = 1
    return node


def rect(i, w, h, fill):
    return {
        "id": i,
        "type": "rectangle",
        "width": w,
        "height": h,
        "fill": fill,
        "cornerRadius": 6,
        "stroke": "$color.border",
        "strokeWidth": 1,
    }


def board(bid, title, width, children):
    return F(
        bid,
        name=title,
        layout="vertical",
        gap=12,
        padding=16,
        width=width,
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius=12,
        children=[
            T(bid + "-title", title, size="$font.size.title", weight="700", growth="fixed-width", width="fill_container"),
            *children,
        ],
    )


def row_h(rid, children):
    return F(rid, layout="horizontal", gap=32, alignItems="start", children=children)


def button(bid, label, kind):
    label_fill = "$color.text"
    weight = "600"
    kids = []
    if kind == "busy":
        kids.append(E(bid + "-dot", 8, "$color.text.secondary"))
    kids.append(T(bid + "-label", label, size="$font.size.ui", weight=weight, fill=label_fill))
    frame = F(
        bid,
        name="Кнопка " + kind,
        reusable=True,
        layout="horizontal",
        gap=8,
        padding=["$space.2", "$space.3"],
        alignItems="center",
        cornerRadius="$radius.md",
        children=kids,
    )
    if kind == "primary":
        frame["fill"] = "$color.primary"
        kids[-1]["fill"] = "$color.text.inverse"
    elif kind in ("secondary", "busy"):
        frame["fill"] = "$color.surface"
        frame["stroke"] = "$color.border"
        frame["strokeWidth"] = 1
        frame["strokeAlignment"] = "inner"
    else:
        kids[-1]["fill"] = "$color.text.secondary"
        kids[-1]["fontWeight"] = "500"
    if kind == "busy":
        frame["opacity"] = 0.72
    return frame


def field(fid, label, value, value_fill="$color.text.muted"):
    return F(
        fid,
        name="Поле " + label,
        reusable=True,
        layout="vertical",
        gap=4,
        width=320,
        children=[
            T(fid + "-label", label, size="$font.size.caption", fill="$color.text.secondary"),
            F(
                fid + "-box",
                layout="horizontal",
                height="$control.height",
                padding=[8, 16],
                alignItems="center",
                width="fill_container",
                fill="$color.surface",
                stroke="$color.border",
                strokeWidth=1,
                strokeAlignment="inner",
                cornerRadius="$radius.md",
                children=[
                    T(fid + "-value", value, fill=value_fill, growth="fixed-width", width="fill_container"),
                ],
            ),
        ],
    )


def alert(aid, text, kind):
    if kind == "error":
        fill, stroke, tfill = "$color.alert.bg", "$color.alert.border", "$color.failed.fg"
    else:
        fill, stroke, tfill = "$color.surface.muted", "$color.border", "$color.text"
    return F(
        aid,
        name="Алерт " + kind,
        reusable=True,
        layout="horizontal",
        padding=12,
        width="fill_container",
        fill=fill,
        stroke=stroke,
        strokeWidth=1,
        cornerRadius="$radius.md",
        children=[
            T(aid + "-text", text, fill=tfill, growth="fixed-width", width="fill_container"),
        ],
    )


def alert_msg(text, kind="error"):
    master = "alert-error" if kind == "error" else "alert-neutral"
    tid = master + "-text"
    return R(uid("al"), master, width="fill_container", descendants={tid: {"content": text}})


def empty_state(eid, text):
    return F(
        eid,
        name=text,
        reusable=True,
        layout="vertical",
        padding=24,
        width="fill_container",
        alignItems="center",
        children=[
            T(eid + "-text", text, fill="$color.text.secondary", textAlign="center", growth="fixed-width", width="fill_container"),
        ],
    )


def badge(bid, word, fg, bg):
    return F(
        bid,
        name="Бейдж " + word,
        reusable=True,
        layout="horizontal",
        padding=[2, 8],
        alignItems="center",
        cornerRadius="$radius.sm",
        fill=bg,
        children=[T(bid + "-t", word, size="$font.size.caption", weight="700", fill=fg)],
    )


def chip():
    return F(
        "chip",
        name="Статус блока",
        reusable=True,
        layout="horizontal",
        padding=[2, 8],
        alignItems="center",
        cornerRadius="$radius.sm",
        fill="$color.surface.muted",
        stroke="$color.border",
        strokeWidth=1,
        children=[T("chip-text", S["st_failed"], size="$font.size.caption", weight="600")],
    )


def kv_master():
    return F(
        "kv",
        name="Пара подпись-значение",
        reusable=True,
        layout="horizontal",
        gap=8,
        alignItems="center",
        width="fill_container",
        children=[
            T("kv-k", "Название", size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width=148),
            T("kv-v", "Joint Relief", growth="fixed-width", width="fill_container"),
        ],
    )


def kv_ref(k, v, mono=False):
    desc = {"kv-k": {"content": k}, "kv-v": {"content": v}}
    if mono:
        desc["kv-v"]["fontFamily"] = "$font.mono"
        desc["kv-v"]["fontSize"] = "$font.size.id"
    return R(uid("kv"), "kv", width="fill_container", descendants=desc)


def note_master():
    return F(
        "note-open",
        name="Аннотация «открытый вопрос»",
        reusable=True,
        layout="vertical",
        gap=4,
        padding=12,
        width=420,
        fill="$color.question.bg",
        stroke="$color.question.border",
        strokeWidth=1,
        cornerRadius="$radius.md",
        children=[
            T("note-open-kicker", "Открытый вопрос", size="$font.size.caption", weight="700", fill="$color.question.fg"),
            T("note-open-body", "Исходное ТЗ не закрывает этот вопрос. Макет не выбирает ответ молча.", growth="fixed-width", width="fill_container", size="$font.size.ui"),
        ],
    )


def note(text, width="fill_container"):
    return R(uid("oq"), "note-open", width=width, descendants={"note-open-body": {"content": text}})


def step_master(kind, sample, marker, extra=None, extra_fill="$color.text", row_fill=None, name_fill="$color.text", name_weight="400"):
    kids = [marker, T(f"step-{kind}-name", sample, weight=name_weight, fill=name_fill, growth="fixed-width", width="fill_container")]
    if extra:
        kids.append(T(f"step-{kind}-extra", extra, fill=extra_fill, weight="700", size="$font.size.caption"))
    frame = F(
        f"step-{kind}",
        name="Шаг " + kind,
        reusable=True,
        layout="horizontal",
        gap=8,
        alignItems="center",
        padding=[6, 8],
        cornerRadius="$radius.md",
        width="fill_container",
        children=kids,
    )
    if row_fill:
        frame["fill"] = row_fill
    return frame


def steps(current, skip=(), overrides=None):
    overrides = overrides or {}
    hit = False
    kids = []
    for name in ORDER:
        if name in skip:
            continue
        if name == current:
            kind = "current"
            hit = True
        elif not hit:
            kind = "done"
        else:
            kind = "pending"
        if name in overrides:
            kind = overrides[name]
        kids.append(
            R(
                uid("st"),
                f"step-{kind}",
                width="fill_container",
                descendants={f"step-{kind}-name": {"content": name}},
            )
        )
    return F(uid("steps"), layout="vertical", gap=4, width="fill_container", children=kids)


def static_item(name, status, finding, path=None):
    p = uid("si")
    badge_id = {"passed": "badge-passed", "warning": "badge-warning", "failed": "badge-failed"}[status]
    kids = [
        F(
            p + "h",
            layout="horizontal",
            gap=8,
            alignItems="center",
            width="fill_container",
            children=[
                T(p + "n", name, weight="600", growth="fixed-width", width="fill_container"),
                R(p + "b", badge_id),
            ],
        ),
        T(p + "f", finding, size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
    ]
    if path:
        kids.append(T(p + "p", path, fontFamily="$font.mono", size="$font.size.id", fill="$color.text.secondary"))
    return F(
        p,
        layout="vertical",
        gap=4,
        padding=[8, 0],
        width="fill_container",
        stroke="$color.border",
        strokeWidth={"bottom": 1},
        children=kids,
    )


def ai_finding(path, quote, shot_h=120):
    return F(
        uid("ai"),
        layout="vertical",
        gap=6,
        width="fill_container",
        children=[
            T(uid("ap"), path, fontFamily="$font.mono", size="$font.size.id", growth="fixed-width", width="fill_container"),
            T(uid("aq"), quote, fontStyle="italic", growth="fixed-width", width="fill_container"),
            R(uid("as"), "shot-placeholder", width="fill_container", height=shot_h),
        ],
    )


def metric_master():
    return F(
        "metric-cell",
        name="Ячейка метрики Lighthouse",
        reusable=True,
        layout="vertical",
        gap=2,
        padding=8,
        width=200,
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.md",
        children=[
            T("metric-name", "performance score", size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            T("metric-value", "64", fontFamily="$font.mono", size="$font.size.title", weight="600", fill="$color.text"),
        ],
    )


def metric(name, value):
    return R(
        uid("mt"),
        "metric-cell",
        width="fill_container",
        descendants={"metric-name": {"content": name}, "metric-value": {"content": value}},
    )


def lh_cols(pairs):
    cols = []
    for side, idx in (("mobile", 0), ("desktop", 1)):
        cols.append(
            F(
                uid("col"),
                layout="vertical",
                gap=8,
                width="fill_container",
                children=[T(uid("sd"), side, weight="700"), *[metric(pair[0], pair[idx + 1]) for pair in pairs]],
            )
        )
    return F(uid("lh"), layout="horizontal", gap=16, width="fill_container", alignItems="start", children=cols)


def block_master():
    return F(
        "block",
        name="Блок отчёта",
        reusable=True,
        layout="vertical",
        gap=8,
        padding=16,
        width="fill_container",
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.lg",
        children=[
            F(
                "block-head",
                layout="horizontal",
                width="fill_container",
                alignItems="center",
                justifyContent="space_between",
                children=[
                    T("block-title", "Статика", size="$font.size.title", weight="700"),
                    R("block-status", "chip"),
                ],
            ),
            F("block-slot", layout="vertical", gap=4, width="fill_container"),
        ],
    )


def block(title, status, children):
    return R(
        uid("blk"),
        "block",
        width="fill_container",
        descendants={
            "block-title": {"content": title},
            "block-status/chip-text": {"content": status},
            "block-slot": {"children": children},
        },
    )


def catalog(rows, selected=None, empty=None):
    kids = [R(uid("th"), "row-head", width="fill_container")]
    if empty == "catalog":
        kids.append(R(uid("em"), "empty-catalog", width="fill_container"))
    elif empty == "search":
        kids.append(R(uid("em"), "empty-search", width="fill_container"))
    else:
        for i, (hid, name, date) in enumerate(rows):
            if i == selected:
                kids.append(
                    R(
                        uid("rw"),
                        "row-selected",
                        width="fill_container",
                        descendants={
                            "row-selected-id": {"content": hid},
                            "row-selected-name": {"content": name},
                            "row-selected-date": {"content": date},
                        },
                    )
                )
            else:
                kids.append(
                    R(
                        uid("rw"),
                        "row",
                        width="fill_container",
                        descendants={
                            "row-id": {"content": hid},
                            "row-name": {"content": name},
                            "row-date": {"content": date},
                        },
                    )
                )
    return F(
        uid("tbl"),
        layout="vertical",
        width="fill_container",
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.lg",
        clip=True,
        children=kids,
    )


def toolbar(search=None, human=None, typed=False, busy=False):
    search_node = R(uid("sf"), "field-search", width=240)
    if search is not None:
        search_node["descendants"] = {"field-search-value": {"content": search, "fill": "$color.text"}}
    human_node = R(uid("hf"), "field-human", width=200)
    if human is not None:
        human_node["descendants"] = {
            "field-human-value": {"content": human, "fill": "$color.text" if typed else "$color.text.muted"}
        }
    refresh = R(uid("rf"), "btn-busy" if busy else "btn-secondary")
    launch = R(uid("go"), "btn-primary", descendants={"btn-primary-label": {"content": S["start"]}})
    return F(
        uid("tb"),
        layout="horizontal",
        gap=12,
        alignItems="end",
        width="fill_container",
        children=[search_node, refresh, F(uid("sp"), width="fill_container", height=8), human_node, launch],
    )


def app_screen(name, height, shell, active, body):
    which = "qa" if shell == "shell-qa" else "tl"
    keys = ["launch", "progress", "reports", "stand"]
    if which == "tl":
        keys += ["costs", "config", "users"]
    desc = {}
    for key in keys:
        desc[f"nav-{which}-{key}"] = {"fill": "$color.nav.active" if key == active else "$color.surface"}
    content = F(
        uid("content"),
        layout="vertical",
        gap=16,
        padding=20,
        width="fill_container",
        height=height,
        clip=True,
        children=body,
    )
    return F(
        uid("screen"),
        name=name,
        layout="horizontal",
        width=1440,
        height=height,
        fill="$color.canvas",
        stroke="$color.border",
        strokeWidth=1,
        clip=True,
        children=[R(uid("sh"), shell, width=220, height=height, descendants=desc), content],
    )


def page_title(text):
    return T(uid("h"), text, size="$font.size.heading", weight="700")


def report_head(date, name="Joint Relief", hid="359226", countries="DE, AT", langs="de, en"):
    return F(
        uid("rh"),
        layout="horizontal",
        gap=24,
        width="fill_container",
        alignItems="start",
        children=[
            F(
                uid("rc"),
                layout="vertical",
                gap=2,
                width="fill_container",
                children=[
                    kv_ref("Название", name),
                    kv_ref("human_id", hid, mono=True),
                    kv_ref("Страны", countries),
                    kv_ref("Языки", langs),
                    kv_ref("Тип", "Preland w/ Form"),
                    kv_ref("Статус в каталоге", "active"),
                    R(uid("cap"), "caption-catalog", width="fill_container"),
                ],
            ),
            F(
                uid("rd"),
                layout="vertical",
                gap=4,
                alignItems="end",
                children=[
                    T(uid("dl"), "Дата отчёта", size="$font.size.caption", fill="$color.text.secondary"),
                    T(uid("dv"), date, weight="700"),
                ],
            ),
        ],
    )


def main_items(prefix_unused=None):
    return [
        static_item("Проверка структуры", "passed", "Корневой index.html на месте.", "index.html"),
        static_item("Проверка отсутствия PHP", "passed", "Файлов PHP в архиве нет."),
        static_item("Проверка размеров изображений", "warning", "Файл изображения крупнее 100 KB.", "images/hero.jpg"),
        static_item("Проверка внешних ссылок", "failed", "Внешний адрес вне разрешённых префиксов.", "index.html"),
        static_item("Проверка дат в индексе", "warning", "В индексе найдена несогласованная дата.", "index.html"),
        static_item("Проверка UTF-8 meta-тега", "passed", "В индексе указан charset utf-8.", "index.html"),
        static_item("Проверка фавикона", "passed", "Фавикон на месте.", "favicon.ico"),
    ]


def prev_items():
    return [
        static_item("Проверка структуры", "passed", "Корневой index.html на месте.", "index.html"),
        static_item("Проверка размеров изображений", "warning", "Файл изображения крупнее 100 KB.", "images/hero.jpg"),
        static_item("Проверка фавикона", "warning", "Фавикон не найден."),
    ]


def quote_now():
    return ai_finding("index.html", "Lose 12 kg in 7 days without diet")


def quote_prev():
    return ai_finding("index.html", "Order now and pay on delivery", 88)


def buttons_ai():
    return F(
        uid("ab"),
        layout="horizontal",
        gap=8,
        alignItems="center",
        children=[
            R(uid("ba"), "btn-primary", descendants={"btn-primary-label": {"content": S["allow_ai"]}}),
            R(uid("bd"), "btn-secondary", descendants={"btn-secondary-label": {"content": S["deny_ai"]}}),
        ],
    )


def nav_item():
    return F(
        "nav-item",
        name="Пункт меню",
        reusable=True,
        layout="horizontal",
        height=32,
        padding=[0, 10],
        alignItems="center",
        cornerRadius="$radius.md",
        width="fill_container",
        children=[T("nav-item-label", "Запуск проверки", size="$font.size.ui", growth="fixed-width", width="fill_container")],
    )


def make_shell(which):
    items = [
        ("launch", "Запуск проверки"),
        ("progress", "Ход проверки"),
        ("reports", "Отчёты"),
        ("stand", "Стенд"),
    ]
    if which == "tl":
        items += [("costs", "Затраты"), ("config", "Конфиг"), ("users", S["users"])]
    role = S["as_tl"] if which == "tl" else S["as_qa"]
    children = [
        T(f"shell-{which}-title", "Помощник QA", weight="700"),
        T(f"shell-{which}-role", role, size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
        F(f"shell-{which}-gap", height=12, width=8),
    ]
    for key, label in items:
        node = R(
            f"nav-{which}-{key}",
            "nav-item",
            width="fill_container",
            descendants={"nav-item-label": {"content": label}},
        )
        if key == "launch":
            node["fill"] = "$color.nav.active"
        children.append(node)
    return F(
        f"shell-{which}",
        name=role,
        reusable=True,
        layout="vertical",
        width=220,
        height=520,
        padding=[16, 12],
        gap=4,
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.md",
        children=children,
    )


def row_master(rid, id_key, name_key, date_key, hid, name, date, selected=False):
    kids = []
    if selected:
        kids.append(
            {
                "id": rid + "-bar",
                "type": "rectangle",
                "layoutPosition": "absolute",
                "x": 0,
                "y": 8,
                "width": 3,
                "height": 24,
                "fill": "$color.primary",
                "cornerRadius": 2,
            }
        )
    kids += [
        T(id_key, hid, fontFamily="$font.mono", size="$font.size.id", growth="fixed-width", width=100),
        T(name_key, name, growth="fixed-width", width="fill_container", weight="600" if selected else "400"),
        T(date_key, date, growth="fixed-width", width=156, fill="$color.text.secondary"),
    ]
    frame = F(
        rid,
        name="Выбранная строка" if selected else "Строка таблицы",
        reusable=True,
        layout="horizontal",
        height="$row.height",
        padding=[0, 12],
        gap=12,
        alignItems="center",
        width="fill_container",
        stroke="$color.border",
        strokeWidth={"bottom": 1},
        children=kids,
    )
    if selected:
        frame["fill"] = "$color.row.selected"
    return frame


def rep_head(hid, labels, widths):
    kids = []
    for i, (lab, w) in enumerate(zip(labels, widths)):
        kids.append(T(f"{hid}-{i}", lab, size="$font.size.caption", weight="700", fill="$color.text.secondary", growth="fixed-width", width=w))
    return F(
        hid,
        name="Шапка " + hid,
        reusable=True,
        layout="horizontal",
        height=36,
        alignItems="center",
        gap=8,
        padding=[0, 12],
        width="fill_container",
        fill="$color.surface.muted",
        children=kids,
    )


def rep_row(rid, prefix, with_who=False):
    def cell(cid, text, width, mono=False):
        kw = {}
        if mono:
            kw["fontFamily"] = "$font.mono"
            kw["fontSize"] = "$font.size.id"
        return T(cid, text, growth="fixed-width", width=width, size="$font.size.ui", **kw)

    kids = [
        cell(prefix + "-date", "07.10.2026 14:32", 148),
        cell(prefix + "-id", "359226", 96, mono=True),
        cell(prefix + "-name", "Joint Relief", "fill_container"),
        F(prefix + "-st-wrap", width=128, layout="horizontal", alignItems="center", children=[
            R(prefix + "-st", "chip", descendants={"chip-text": {"content": S["st_failed"]}})
        ]),
        F(prefix + "-ai-wrap", width=360, layout="horizontal", alignItems="center", children=[
            R(prefix + "-ai", "chip", descendants={"chip-text": {"content": S["ai_ready"]}})
        ]),
        F(prefix + "-lh-wrap", width=140, layout="horizontal", alignItems="center", children=[
            R(prefix + "-lh", "chip", descendants={"chip-text": {"content": S["lh_ok"]}})
        ]),
    ]
    if with_who:
        kids.append(cell(prefix + "-who", "qa.ivan", 120))
    return F(
        rid,
        name="Строка отчётов " + ("ТЛ" if with_who else "QA"),
        reusable=True,
        layout="horizontal",
        height=48,
        alignItems="center",
        gap=8,
        padding=[0, 12],
        width="fill_container",
        stroke="$color.border",
        strokeWidth={"bottom": 1},
        children=kids,
    )


def qa_report_table(rows):
    kids = [R(uid("rh"), "rep-head-qa", width="fill_container")]
    for date, hid, name, st, ai, lh in rows:
        kids.append(
            R(
                uid("rr"),
                "rep-row-qa",
                width="fill_container",
                descendants={
                    "rep-qa-date": {"content": date},
                    "rep-qa-id": {"content": hid},
                    "rep-qa-name": {"content": name},
                    "rep-qa-st/chip-text": {"content": st},
                    "rep-qa-ai/chip-text": {"content": ai},
                    "rep-qa-lh/chip-text": {"content": lh},
                },
            )
        )
    return table_frame(kids)


def tl_report_table(rows):
    kids = [R(uid("rh"), "rep-head-tl", width="fill_container")]
    for date, hid, name, st, ai, lh, who in rows:
        kids.append(
            R(
                uid("rr"),
                "rep-row-tl",
                width="fill_container",
                descendants={
                    "rep-tl-date": {"content": date},
                    "rep-tl-id": {"content": hid},
                    "rep-tl-name": {"content": name},
                    "rep-tl-st/chip-text": {"content": st},
                    "rep-tl-ai/chip-text": {"content": ai},
                    "rep-tl-lh/chip-text": {"content": lh},
                    "rep-tl-who": {"content": who},
                },
            )
        )
    return table_frame(kids)


def table_frame(kids):
    return F(
        uid("tbl"),
        layout="vertical",
        width="fill_container",
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.lg",
        clip=True,
        children=kids,
    )


def labeled_lines(label, lines, mono=False):
    texts = []
    for line in lines:
        kw = {"fontFamily": "$font.mono", "size": "$font.size.id"} if mono else {"size": "$font.size.ui"}
        texts.append(T(uid("ln"), line, growth="fixed-width", width="fill_container", **kw))
    return F(
        uid("lb"),
        layout="vertical",
        gap=4,
        width="fill_container",
        children=[
            T(uid("ll"), label, weight="700"),
            F(
                uid("bx"),
                layout="vertical",
                gap=4,
                padding=12,
                width="fill_container",
                fill="$color.surface",
                stroke="$color.border",
                strokeWidth=1,
                cornerRadius="$radius.md",
                children=texts,
            ),
        ],
    )


def build_variables():
    colors = {
        "color.canvas": "#F3F4F6",
        "color.surface": "#FFFFFF",
        "color.surface.muted": "#F6F7F9",
        "color.border": "#D8DEE6",
        "color.border.strong": "#B7C0CC",
        "color.text": "#1B2128",
        "color.text.secondary": "#3E4853",
        "color.text.muted": "#5C6772",
        "color.text.inverse": "#FFFFFF",
        "color.primary": "#243140",
        "color.nav.active": "#E7EDF4",
        "color.row.selected": "#E4EDF7",
        "color.focus": "#1D4E89",
        "color.passed.fg": "#0E5C34",
        "color.passed.bg": "#E5F4EC",
        "color.warning.fg": "#6A4500",
        "color.warning.bg": "#FFF4D6",
        "color.failed.fg": "#8C1D1D",
        "color.failed.bg": "#FDECEC",
        "color.alert.bg": "#FDECEC",
        "color.alert.border": "#E4B4B4",
        "color.question.bg": "#FBF6EA",
        "color.question.border": "#D2B56A",
        "color.question.fg": "#6B4E12",
    }
    variables = {key: {"type": "color", "value": val} for key, val in colors.items()}
    numbers = {
        "font.size.caption": 12,
        "font.size.ui": 13,
        "font.size.body": 14,
        "font.size.title": 18,
        "font.size.heading": 22,
        "font.size.id": 13,
        "space.1": 4,
        "space.2": 8,
        "space.3": 12,
        "space.4": 16,
        "space.5": 20,
        "space.6": 24,
        "radius.sm": 4,
        "radius.md": 6,
        "radius.lg": 8,
        "control.height": 44,
        "row.height": 40,
    }
    for key, val in numbers.items():
        variables[key] = {"type": "number", "value": val}
    variables["font.family"] = {"type": "string", "value": "Inter"}
    variables["font.mono"] = {"type": "string", "value": "JetBrains Mono"}
    return variables, colors


def swatch(key, label, hex_value):
    return F(
        uid("sw"),
        layout="horizontal",
        gap=8,
        alignItems="center",
        children=[
            rect(uid("rc"), 36, 36, "$" + key),
            F(
                uid("sl"),
                layout="vertical",
                gap=0,
                children=[
                    T(uid("sn"), label, size="$font.size.ui", weight="600"),
                    T(uid("sh"), hex_value, fontFamily="$font.mono", size="$font.size.caption", fill="$color.text.muted"),
                ],
            ),
        ],
    )


def build_kit(colors):
    neutrals = [
        ("color.canvas", "Холст", colors["color.canvas"]),
        ("color.surface", "Поверхность", colors["color.surface"]),
        ("color.surface.muted", "Приглушённый фон", colors["color.surface.muted"]),
        ("color.border", "Граница", colors["color.border"]),
        ("color.border.strong", "Граница сильнее", colors["color.border.strong"]),
        ("color.text", "Текст", colors["color.text"]),
        ("color.text.secondary", "Вторичный текст", colors["color.text.secondary"]),
        ("color.text.muted", "Подсказка", colors["color.text.muted"]),
        ("color.text.inverse", "Текст на тёмном", colors["color.text.inverse"]),
        ("color.primary", "Действие primary", colors["color.primary"]),
        ("color.nav.active", "Пункт меню активен", colors["color.nav.active"]),
        ("color.row.selected", "Строка выбрана", colors["color.row.selected"]),
        ("color.focus", "Фокус", colors["color.focus"]),
    ]
    statuses = [
        ("color.passed.fg", "passed · пункт", colors["color.passed.fg"]),
        ("color.passed.bg", "passed · фон пункта", colors["color.passed.bg"]),
        ("color.warning.fg", "warning · пункт", colors["color.warning.fg"]),
        ("color.warning.bg", "warning · фон пункта", colors["color.warning.bg"]),
        ("color.failed.fg", "failed · пункт", colors["color.failed.fg"]),
        ("color.failed.bg", "failed · фон пункта", colors["color.failed.bg"]),
    ]
    service = [
        ("color.alert.bg", "Фон ошибки", colors["color.alert.bg"]),
        ("color.alert.border", "Граница ошибки", colors["color.alert.border"]),
        ("color.question.bg", "Фон открытого вопроса", colors["color.question.bg"]),
        ("color.question.border", "Граница вопроса", colors["color.question.border"]),
        ("color.question.fg", "Текст вопроса", colors["color.question.fg"]),
    ]

    def col(title, items):
        return F(
            uid("cc"),
            layout="vertical",
            gap=8,
            width="fill_container",
            children=[T(uid("ct"), title, weight="700"), *[swatch(k, lab, hx) for k, lab, hx in items]],
        )

    colors_board = board(
        "kit-colors",
        "UI-kit · Цвета",
        760,
        [
            T(
                uid("cr"),
                "passed, warning и failed — статус пункта статики. Трёхцветной итоговой плашки страницы нет.",
                fill="$color.text.secondary",
                growth="fixed-width",
                width="fill_container",
                size="$font.size.ui",
            ),
            F(uid("cg"), layout="horizontal", gap=24, alignItems="start", width="fill_container", children=[col("Нейтральные", neutrals), col("Статус пункта", statuses)]),
            col("Служебные", service),
        ],
    )

    type_board = board(
        "kit-type",
        "UI-kit · Типографика",
        460,
        [
            T(uid("k1"), "Заголовок · Inter 22 / 700", size="$font.size.caption", fill="$color.text.muted"),
            T("type-h1", "Помощник QA", size="$font.size.heading", weight="700"),
            T(uid("k2"), "Заголовок раздела · Inter 18 / 700", size="$font.size.caption", fill="$color.text.muted"),
            T("type-h2", "Статика", size="$font.size.title", weight="700"),
            T(uid("k3"), "Текст · Inter 14 / 400", size="$font.size.caption", fill="$color.text.muted"),
            T(
                "report-line",
                S["disclaimer"],
                reusable=True,
                name="Строка отчёта",
                growth="fixed-width",
                width="fill_container",
            ),
            T(uid("k4"), "Подпись · Inter 12 / 400", size="$font.size.caption", fill="$color.text.muted"),
            T(
                "caption-catalog",
                S["cat_status"],
                reusable=True,
                name="Подпись статуса каталога",
                size="$font.size.caption",
                fill="$color.text.secondary",
                growth="fixed-width",
                width="fill_container",
            ),
            T(uid("k5"), "Моноширинный id · JetBrains Mono 13", size="$font.size.caption", fill="$color.text.muted"),
            T("type-mono", "359226", fontFamily="$font.mono", size="$font.size.id", weight="600"),
            T(uid("k6"), "Отступы 4 · 8 · 12 · 16 · 20 · 24. Радиусы 4 · 6 · 8.", size="$font.size.caption", fill="$color.text.muted", growth="fixed-width", width="fill_container"),
        ],
    )

    buttons_board = board(
        "kit-buttons",
        "UI-kit · Кнопки",
        420,
        [
            T(uid("bp"), "primary", size="$font.size.caption", fill="$color.text.muted"),
            button("btn-primary", S["login"], "primary"),
            R(uid("b1"), "btn-primary", descendants={"btn-primary-label": {"content": S["start"]}}),
            R(uid("b2"), "btn-primary", descendants={"btn-primary-label": {"content": S["allow_ai"]}}),
            R(uid("b3"), "btn-primary", descendants={"btn-primary-label": {"content": S["allow_land"]}}),
            R(
                uid("bf"),
                "btn-primary",
                stroke="$color.focus",
                strokeWidth=2,
                strokeAlignment="outer",
                descendants={"btn-primary-label": {"content": S["login"]}},
            ),
            T(uid("bfl"), "Состояние фокуса", size="$font.size.caption", fill="$color.text.muted"),
            T(uid("bs"), "secondary", size="$font.size.caption", fill="$color.text.muted"),
            button("btn-secondary", S["refresh"], "secondary"),
            R(uid("b4"), "btn-secondary", descendants={"btn-secondary-label": {"content": S["deny_ai"]}}),
            T(uid("bq"), "quiet", size="$font.size.caption", fill="$color.text.muted"),
            button("btn-quiet", S["refresh"], "quiet"),
            T(uid("bb"), "Обновить — идёт запрос каталога", size="$font.size.caption", fill="$color.text.muted"),
            button("btn-busy", S["refresh"], "busy"),
        ],
    )

    flag = F(
        "flag-on",
        name="expectFormMacro",
        reusable=True,
        layout="horizontal",
        gap=8,
        alignItems="center",
        children=[
            F(
                "flag-on-track",
                width=36,
                height=20,
                cornerRadius=10,
                fill="$color.primary",
                padding=[2, 2],
                layout="horizontal",
                justifyContent="end",
                alignItems="center",
                children=[E("flag-on-knob", 16, "$color.text.inverse")],
            ),
            T("flag-on-label", "expectFormMacro · включён (true)", weight="700", size="$font.size.ui"),
        ],
    )

    fields_board = board(
        "kit-fields",
        "UI-kit · Поля",
        400,
        [
            field("field-login", S["user"], ""),
            field("field-password", S["pass"], ""),
            field("field-search", S["search"], ""),
            field("field-human", "human_id", "359226"),
            T(uid("fh"), "Подсказка формата в поле human_id: 359226", size="$font.size.caption", fill="$color.text.muted", growth="fixed-width", width="fill_container"),
            flag,
        ],
    )

    row_head = F(
        "row-head",
        name="Шапка каталога",
        reusable=True,
        layout="horizontal",
        height=36,
        padding=[0, 12],
        gap=12,
        alignItems="center",
        width="fill_container",
        fill="$color.surface.muted",
        children=[
            T("row-head-id", "id", size="$font.size.caption", weight="700", fill="$color.text.secondary", growth="fixed-width", width=100),
            T("row-head-name", "Лендинг", size="$font.size.caption", weight="700", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            T("row-head-date", "Создано", size="$font.size.caption", weight="700", fill="$color.text.secondary", growth="fixed-width", width=156),
        ],
    )
    row = row_master("row", "row-id", "row-name", "row-date", "359180", "Cardio Form", "06.10.2026 18:05", False)
    row_sel = row_master("row-selected", "row-selected-id", "row-selected-name", "row-selected-date", "359226", "Joint Relief", "07.10.2026 14:32", True)

    qa_widths = [148, 96, "fill_container", 128, 360, 140]
    tl_widths = qa_widths + [120]
    qa_labels = ["Дата", "human_id", "Название", "Статика", "ИИ", "Lighthouse"]
    tl_labels = qa_labels + ["Кто запустил"]

    user_row = F(
        "user-row",
        name="Строка пользователя",
        reusable=True,
        layout="horizontal",
        height="$row.height",
        alignItems="center",
        gap=12,
        padding=[0, 12],
        width="fill_container",
        stroke="$color.border",
        strokeWidth={"bottom": 1},
        children=[
            T("user-row-login", "qa.ivan", fontFamily="$font.mono", size="$font.size.id", growth="fixed-width", width=220),
            T("user-row-role", "QA", growth="fixed-width", width=80),
            F("user-row-extra", layout="horizontal", alignItems="center", width="fill_container"),
        ],
    )

    table_board = board(
        "kit-table",
        "UI-kit · Таблица",
        1120,
        [
            T(uid("tt"), "Каталог: id, Лендинг, Создано. Больший id сверху.", size="$font.size.caption", fill="$color.text.muted", growth="fixed-width", width="fill_container"),
            table_frame([
                row_head,
                row_sel,
                row,
                R(uid("r3"), "row", width="fill_container", descendants={
                    "row-id": {"content": "358901"},
                    "row-name": {"content": "Slim Tea"},
                    "row-date": {"content": "05.10.2026 11:20"},
                }),
            ]),
            T(uid("tr"), "Строка списка отчётов QA", size="$font.size.caption", fill="$color.text.muted"),
            table_frame([rep_head("rep-head-qa", qa_labels, qa_widths), rep_row("rep-row-qa", "rep-qa", False)]),
            T(uid("tl"), "Строка списка отчётов ТЛ — колонка «Кто запустил»", size="$font.size.caption", fill="$color.text.muted"),
            table_frame([rep_head("rep-head-tl", tl_labels, tl_widths), rep_row("rep-row-tl", "rep-tl", True)]),
            user_row,
        ],
    )

    chip_node = chip()
    phrases = [
        S["st_failed"], S["st_warn"], S["st_ok"], S["st_broke"],
        S["ai_ready"], S["ai_wait"], S["ai_err"], S["lh_ok"], S["lh_err"], S["env"],
    ]
    badges_board = board(
        "kit-badges",
        "UI-kit · Бейджи статусов",
        520,
        [
            T(uid("bi"), "Статус пункта. Не вердикт страницы.", size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            F(uid("brow"), layout="horizontal", gap=8, children=[
                badge("badge-passed", "passed", "$color.passed.fg", "$color.passed.bg"),
                badge("badge-warning", "warning", "$color.warning.fg", "$color.warning.bg"),
                badge("badge-failed", "failed", "$color.failed.fg", "$color.failed.bg"),
            ]),
            T(uid("bb2"), "Статусы блоков. Нейтральная плашка, не трёхцветный итог страницы.", size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            chip_node,
            *[R(uid("cp"), "chip", descendants={"chip-text": {"content": phrase}}) for phrase in phrases[1:]],
        ],
    )

    card = F(
        "card",
        name="Карточка до скачивания",
        reusable=True,
        layout="vertical",
        padding=16,
        width="fill_container",
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.lg",
        children=[
            F(
                "card-slot",
                layout="vertical",
                gap=8,
                width="fill_container",
                children=[
                    F(
                        "card-top",
                        layout="horizontal",
                        gap=16,
                        width="fill_container",
                        alignItems="start",
                        children=[
                            F(
                                "card-preview",
                                layout="vertical",
                                width=240,
                                height=148,
                                padding=12,
                                justifyContent="center",
                                alignItems="center",
                                fill="$color.surface.muted",
                                stroke="$color.border",
                                strokeWidth=1,
                                cornerRadius="$radius.md",
                                children=[
                                    T(
                                        "card-preview-caption",
                                        S["preview"],
                                        size="$font.size.caption",
                                        fill="$color.text.secondary",
                                        textAlign="center",
                                        growth="fixed-width",
                                        width=216,
                                    )
                                ],
                            ),
                            F(
                                "card-facts",
                                layout="vertical",
                                gap=2,
                                width="fill_container",
                                children=[
                                    kv_ref("Название", "Joint Relief"),
                                    kv_ref("human_id", "359226", mono=True),
                                    kv_ref("Страны", "DE, AT"),
                                    kv_ref("Языки", "de, en"),
                                    kv_ref("Тип", "Preland w/ Form"),
                                    kv_ref("Статус в каталоге", "active"),
                                    R("card-status-note", "caption-catalog", width="fill_container"),
                                    kv_ref("Варианты", "A, B"),
                                ],
                            ),
                        ],
                    )
                ],
            )
        ],
    )

    shot = F(
        "shot-placeholder",
        name="Плейсхолдер скриншота",
        reusable=True,
        layout="horizontal",
        height=120,
        width="fill_container",
        alignItems="center",
        justifyContent="center",
        fill="$color.surface.muted",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.md",
        children=[T("shot-placeholder-label", "Скриншот", fill="$color.text.muted")],
    )

    card_board = board(
        "kit-card",
        "UI-kit · Карточка",
        640,
        [
            kv_master(),
            card,
            shot,
            block_master(),
        ],
    )

    alerts_board = board(
        "kit-alerts",
        "UI-kit · Алерт и пустые состояния",
        560,
        [
            alert("alert-error", S["bad_login"], "error"),
            alert_msg(S["miss"]),
            alert_msg(S["collision"]),
            alert_msg(S["part"]),
            alert_msg(S["dup"]),
            alert("alert-neutral", S["replaced"], "neutral"),
            alert_msg(S["no_prev"], "neutral"),
            alert_msg(S["no_usage"], "neutral"),
            alert_msg(S["fork"], "neutral"),
            alert_msg(S["iso"], "neutral"),
            empty_state("empty-catalog", S["empty_cat"]),
            empty_state("empty-search", S["empty_search"]),
        ],
    )

    steps_board = board(
        "kit-steps",
        "UI-kit · Список шагов проверки",
        520,
        [
            T(uid("sk"), "Текущий, готовый, ошибка части, идёт повтор, не начат. Общего креста на ленд нет.", size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            step_master("done", "Поиск в каталоге", T("step-done-mark", "✓", fill="$color.passed.fg", weight="700")),
            step_master(
                "current",
                "Статические проверки",
                E("step-current-mark", 8, "$color.primary"),
                name_weight="700",
                row_fill="$color.nav.active",
            ),
            step_master(
                "error",
                "Скачивание архива",
                T("step-error-mark", "!", fill="$color.failed.fg", weight="700"),
                extra=S["part"],
                extra_fill="$color.failed.fg",
                row_fill="$color.failed.bg",
            ),
            step_master(
                "retry",
                "ИИ",
                E("step-retry-mark", 8, "$color.warning.fg"),
                extra=S["retry"],
                extra_fill="$color.warning.fg",
                row_fill="$color.warning.bg",
            ),
            step_master(
                "pending",
                "Lighthouse",
                E("step-pending-mark", 8, "#00000000", stroke="$color.border.strong"),
                name_fill="$color.text.muted",
            ),
            T(uid("sk2"), "ИИ и Lighthouse могут идти одновременно. Замка очереди нет.", size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
        ],
    )

    metric_board = board(
        "kit-metric",
        "UI-kit · Ячейка метрики Lighthouse",
        340,
        [
            metric_master(),
            R(uid("m2"), "metric-cell", descendants={"metric-name": {"content": "Largest Contentful Paint"}, "metric-value": {"content": "3,4 с"}}),
            T(uid("mk"), "Оба значения одним цветом. Шкалы оценки балла нет.", size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            note(Q_LH, 300),
        ],
    )

    question_board = board(
        "kit-question",
        "UI-kit · Аннотация «открытый вопрос»",
        480,
        [note_master()],
    )

    shell_tl_board = board(
        "kit-shell-tl",
        "UI-kit · Оболочка — Вы вошли как ТЛ",
        320,
        [nav_item(), make_shell("tl")],
    )
    shell_qa_board = board(
        "kit-shell-qa",
        "UI-kit · Оболочка — Вы вошли как QA",
        320,
        [make_shell("qa")],
    )

    rows = [
        row_h("row-kit-1", [colors_board, type_board, buttons_board, fields_board]),
        row_h("row-kit-2", [table_board, badges_board]),
        row_h("row-kit-3", [card_board, alerts_board]),
        row_h("row-kit-4", [shell_tl_board, shell_qa_board, steps_board, metric_board, question_board]),
    ]
    return rows


def login_screen(name, height, with_error=False):
    slot = [
        page_title("Вход"),
        R(uid("fl"), "field-login", width="fill_container"),
        R(uid("fp"), "field-password", width="fill_container"),
    ]
    if with_error:
        slot.append(alert_msg(S["bad_login"]))
    slot.append(R(uid("bl"), "btn-primary"))
    return F(
        uid("screen"),
        name=name,
        layout="vertical",
        width=1440,
        height=height,
        fill="$color.canvas",
        stroke="$color.border",
        strokeWidth=1,
        alignItems="center",
        justifyContent="center",
        children=[
            R(uid("lg"), "card", width=400, descendants={"card-slot": {"children": slot}}),
        ],
    )


def launch_body(rows, selected=None, search=None, human=None, typed=False, busy=False, empty=None, alert=None, show_card=False):
    body = [page_title("Запуск проверки"), toolbar(search, human, typed, busy), catalog(rows, selected, empty)]
    if alert:
        body.append(alert)
    if show_card:
        body.append(R(uid("cd"), "card", width="fill_container"))
    return body


def users_table():
    def urow(login, role, env=False):
        desc = {"user-row-login": {"content": login}, "user-row-role": {"content": role}}
        if env:
            desc["user-row-extra"] = {"children": [R(uid("env"), "chip", descendants={"chip-text": {"content": S["env"]}})]}
        return R(uid("ur"), "user-row", width="fill_container", descendants=desc)

    head = F(
        uid("uh"),
        layout="horizontal",
        height=36,
        alignItems="center",
        padding=[0, 12],
        gap=12,
        fill="$color.surface.muted",
        width="fill_container",
        children=[
            T(uid("u1"), "Логин", width=220, growth="fixed-width", size="$font.size.caption", weight="700", fill="$color.text.secondary"),
            T(uid("u2"), "Роль", width=80, growth="fixed-width", size="$font.size.caption", weight="700", fill="$color.text.secondary"),
        ],
    )
    return table_frame([head, urow("admin", "ТЛ", True), urow("qa.ivan", "QA"), urow("qa.maria", "QA")])


def role_picker():
    def opt(label, on):
        return F(
            uid("opt"),
            layout="horizontal",
            padding=[8, 12],
            cornerRadius="$radius.md",
            fill="$color.nav.active" if on else "$color.surface",
            stroke="$color.border",
            strokeWidth=1,
            children=[T(uid("ol"), label, weight="700" if on else "500")],
        )

    return F(
        uid("rp"),
        layout="vertical",
        gap=4,
        children=[
            T(uid("rl"), "Роль", size="$font.size.caption", fill="$color.text.secondary"),
            F(uid("rs"), layout="horizontal", gap=8, children=[opt("ТЛ", False), opt("QA", True)]),
        ],
    )


def user_form(login_value=None, alert=None):
    login = R(uid("ul"), "field-login", width=320)
    if login_value is not None:
        login["descendants"] = {"field-login-value": {"content": login_value, "fill": "$color.text"}}
    kids = [
        login,
        R(uid("up"), "field-password", width=320),
        role_picker(),
    ]
    if alert is not None:
        kids.append(alert)
    kids.append(R(uid("uc"), "btn-primary", descendants={"btn-primary-label": {"content": S["create"]}}))
    return F(uid("uf"), layout="vertical", gap=12, width=360, children=kids)


def config_body():
    cond = (
        "Рядом с флагом, не одним плоским запретом. При включённом expectFormMacro в index обязателен {{form}}, "
        "запрещены {{link}} и {offer}. При выключенном флаге {{form}} запрещён, {{link}} обязателен хотя бы раз. "
        "В одном html вместе: {{aio:macros:tracker_protection_1}}, {{aio:macros:tracker_protection_2}}, {{aio:macros:tracker_protection_3}}. "
        "В index обязателен {{aio.visit.fields.offer_name.for_visitors}}."
    )
    return [
        page_title("Конфиг"),
        T(uid("nh"), S["no_history"], fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
        labeled_lines("Разрешённые внешние префиксы", PREFIXES, mono=True),
        labeled_lines("Запрещённые макросы", MACROS, mono=True),
        R(uid("fg"), "flag-on"),
        T(uid("nf"), S["not_from_type"], size="$font.size.caption", fill="$color.text.secondary"),
        T(uid("cd"), cond, growth="fixed-width", width="fill_container", size="$font.size.ui"),
        labeled_lines("Запрещённые скриптовые признаки", SCRIPTS),
        note(Q_LISTS),
        labeled_lines(
            "Порог изображений",
            ["Больше 100 KB и не больше 200 KB — warning.", "Больше 200 KB — failed."],
        ),
        labeled_lines(
            "Порог CSS",
            ["До 50 KB — норма.", "От 50 KB до 150 KB включительно — warning.", "Больше 150 KB — failed."],
        ),
        labeled_lines(
            "Порог встроенного скрипта",
            ["Больше 10 непустых строк — failed, с исключением whitelist в class."],
        ),
        F(
            uid("lgf"),
            layout="vertical",
            gap=4,
            width="fill_container",
            children=[
                T(uid("lgl"), "Ожидаемые языки поверх метаданных ленда", weight="700"),
                F(
                    uid("lgb"),
                    height="$control.height",
                    padding=[8, 16],
                    width="fill_container",
                    fill="$color.surface",
                    stroke="$color.border",
                    strokeWidth=1,
                    cornerRadius="$radius.md",
                ),
                T(uid("lgc"), S["langs_cap"], size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
                note(Q_LANG),
            ],
        ),
        R(uid("sv"), "btn-primary", descendants={"btn-primary-label": {"content": S["save"]}}),
    ]


def stand_view(url=None):
    bar_kids = []
    if url:
        bar_kids.append(T(uid("vu"), url, fontFamily="$font.mono", size="$font.size.id"))
    return F(
        uid("view"),
        layout="vertical",
        width="fill_container",
        height=360,
        fill="$color.surface",
        stroke="$color.border",
        strokeWidth=1,
        cornerRadius="$radius.lg",
        clip=True,
        children=[
            F(
                uid("bar"),
                layout="horizontal",
                height=36,
                padding=[0, 12],
                alignItems="center",
                width="fill_container",
                fill="$color.surface.muted",
                stroke="$color.border",
                strokeWidth={"bottom": 1},
                children=bar_kids,
            ),
            F(uid("blank"), width="fill_container", height="fill_container", fill="$color.surface"),
        ],
    )


def build_screens():
    screens = []
    screens.append(login_screen("01 Вход", 720, False))
    screens.append(login_screen("01 Вход — ошибка", 760, True))

    screens.append(app_screen("02 Запуск — строка выбрана", 980, "shell-qa", "launch", launch_body(ROWS, selected=0, show_card=True)))
    screens.append(app_screen("02 Запуск — пустой каталог", 720, "shell-qa", "launch", launch_body(ROWS, empty="catalog")))
    screens.append(app_screen("02 Запуск — пустой поиск", 720, "shell-qa", "launch", launch_body(ROWS, search="zzz", empty="search")))
    screens.append(app_screen("02 Запуск — обновление каталога", 860, "shell-qa", "launch", launch_body(ROWS, busy=True)))
    screens.append(app_screen(
        "03 Нет среди последних 300",
        860,
        "shell-qa",
        "launch",
        launch_body(ROWS, human="100001", typed=True, alert=alert_msg(S["miss"])),
    ))
    screens.append(app_screen(
        "03 Коллизия human_id",
        900,
        "shell-qa",
        "launch",
        launch_body(COLLIDE, human="359226", typed=True, alert=alert_msg(S["collision"])),
    ))

    screens.append(app_screen(
        "04 Ход — текущий шаг",
        860,
        "shell-qa",
        "progress",
        [page_title("Ход проверки"), steps("Статические проверки", skip={"Решение по ИИ"})],
    ))
    screens.append(app_screen(
        "04 Ход — ИИ и Lighthouse одновременно",
        860,
        "shell-qa",
        "progress",
        [page_title("Ход проверки"), steps("ИИ", skip={"Решение по ИИ"}, overrides={"Lighthouse": "current"})],
    ))
    screens.append(app_screen(
        "04 Ход — идёт повтор",
        860,
        "shell-qa",
        "progress",
        [page_title("Ход проверки"), steps("ИИ", skip={"Решение по ИИ"}, overrides={"ИИ": "retry"})],
    ))
    screens.append(app_screen(
        "04 Ход — ошибка этой части",
        860,
        "shell-qa",
        "progress",
        [page_title("Ход проверки"), steps("Скачивание архива", skip={"Решение по ИИ"}, overrides={"Скачивание архива": "error"})],
    ))
    screens.append(app_screen(
        "04 Ход — просмотр заменён",
        940,
        "shell-qa",
        "progress",
        [
            page_title("Ход проверки"),
            alert_msg(S["replaced"], "neutral"),
            steps("Статические проверки", skip={"Решение по ИИ"}),
        ],
    ))
    screens.append(app_screen(
        "04 Ход — отказ от ИИ",
        1280,
        "shell-qa",
        "progress",
        [
            page_title("Ход проверки"),
            steps("Решение по ИИ", overrides={"Решение по ИИ": "done"}),
            note(Q_REFUSAL),
            block("Статика", S["st_failed"], [
                static_item("Проверка внешних ссылок", "failed", "Внешний адрес вне разрешённых префиксов.", "index.html"),
            ]),
        ],
    ))

    screens.append(app_screen(
        "05 Развилка ИИ",
        1280,
        "shell-qa",
        "progress",
        [
            page_title("Развилка ИИ"),
            steps("Решение по ИИ"),
            alert_msg(S["fork"], "neutral"),
            buttons_ai(),
            block("Статика", S["st_failed"], [
                static_item("Проверка размеров изображений", "warning", "Файл изображения крупнее 100 KB.", "images/hero.jpg"),
                static_item("Проверка внешних ссылок", "failed", "Внешний адрес вне разрешённых префиксов.", "index.html"),
                static_item("Проверка фавикона", "passed", "Фавикон на месте.", "favicon.ico"),
            ]),
            block("ИИ", S["ai_wait"], []),
        ],
    ))
    screens.append(app_screen(
        "05 Структура failed",
        1100,
        "shell-qa",
        "progress",
        [
            page_title("Развилка ИИ"),
            T(uid("ss"), S["structure"], growth="fixed-width", width="fill_container"),
            buttons_ai(),
            block("Статика", S["st_failed"], [
                static_item("Проверка структуры", "failed", "В корне нет ожидаемого index.html."),
            ]),
            block("ИИ", S["ai_wait"], []),
        ],
    ))

    screens.append(app_screen(
        "06 Отчёт",
        2140,
        "shell-qa",
        "reports",
        [
            page_title("Отчёт"),
            report_head("07.10.2026 14:32"),
            R(uid("ds"), "report-line", width="fill_container"),
            block("Статика", S["st_failed"], main_items()),
            block("ИИ", S["ai_ready"], [quote_now()]),
            block("Lighthouse", S["lh_ok"], [lh_cols(METRICS)]),
        ],
    ))
    screens.append(app_screen(
        "06 Отчёт — список ИИ пуст",
        1860,
        "shell-qa",
        "reports",
        [
            page_title("Отчёт"),
            report_head("07.10.2026 14:32"),
            R(uid("ds"), "report-line", width="fill_container"),
            block("Статика", S["st_warn"], prev_items()),
            block("ИИ", S["ai_ready"], []),
            block("Lighthouse", S["lh_ok"], [lh_cols(METRICS)]),
        ],
    ))
    screens.append(app_screen(
        "06 Отчёт — ошибка ИИ",
        1980,
        "shell-qa",
        "reports",
        [
            page_title("Отчёт"),
            report_head("07.10.2026 14:32"),
            R(uid("ds"), "report-line", width="fill_container"),
            block("Статика", S["st_failed"], main_items()),
            block("ИИ", S["ai_err"], [alert_msg(S["part"])]),
            block("Lighthouse", S["lh_ok"], [lh_cols(METRICS)]),
        ],
    ))
    screens.append(app_screen(
        "06 Отчёт — ошибка прогона Lighthouse",
        1980,
        "shell-qa",
        "reports",
        [
            page_title("Отчёт"),
            report_head("07.10.2026 14:32"),
            R(uid("ds"), "report-line", width="fill_container"),
            block("Статика", S["st_failed"], main_items()),
            block("ИИ", S["ai_ready"], [quote_now()]),
            block("Lighthouse", S["lh_err"], [alert_msg(S["part"])]),
        ],
    ))

    screens.append(app_screen(
        "07 Сравнение",
        1980,
        "shell-qa",
        "reports",
        [
            page_title("Сравнение"),
            R(uid("ds"), "report-line", width="fill_container"),
            F(
                uid("cmp"),
                layout="horizontal",
                gap=16,
                width="fill_container",
                alignItems="start",
                children=[
                    F(uid("c1"), layout="vertical", gap=12, width="fill_container", children=[
                        T(uid("c1t"), "Текущий отчёт", size="$font.size.title", weight="700"),
                        report_head("07.10.2026 14:32"),
                        block("Статика", S["st_failed"], [
                            static_item("Проверка внешних ссылок", "failed", "Внешний адрес вне разрешённых префиксов.", "index.html"),
                            static_item("Проверка размеров изображений", "warning", "Файл изображения крупнее 100 KB.", "images/hero.jpg"),
                        ]),
                        block("ИИ", S["ai_ready"], [quote_now()]),
                        block("Lighthouse", S["lh_ok"], [lh_cols(METRICS)]),
                    ]),
                    F(uid("c2"), layout="vertical", gap=12, width="fill_container", children=[
                        T(uid("c2t"), "Прошлый отчёт", size="$font.size.title", weight="700"),
                        report_head("21.09.2026 09:15"),
                        block("Статика", S["st_warn"], prev_items()),
                        block("ИИ", S["ai_ready"], [quote_prev()]),
                        block("Lighthouse", S["lh_ok"], [lh_cols(METRICS_PREV)]),
                    ]),
                ],
            ),
        ],
    ))
    screens.append(app_screen(
        "07 Сравнение — прошлого отчёта нет",
        1860,
        "shell-qa",
        "reports",
        [
            page_title("Сравнение"),
            alert_msg(S["no_prev"], "neutral"),
            R(uid("ds"), "report-line", width="fill_container"),
            report_head("07.10.2026 14:32"),
            block("Статика", S["st_failed"], [
                static_item("Проверка внешних ссылок", "failed", "Внешний адрес вне разрешённых префиксов.", "index.html"),
                static_item("Проверка структуры", "passed", "Корневой index.html на месте.", "index.html"),
            ]),
            block("ИИ", S["ai_ready"], [quote_now()]),
            block("Lighthouse", S["lh_ok"], [lh_cols(METRICS)]),
        ],
    ))

    url = "https://stand.internal/s/359226"
    screens.append(app_screen(
        "08 Стенд — QA",
        1180,
        "shell-qa",
        "stand",
        [
            page_title("Стенд"),
            T(uid("tc"), S["temp"], size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            T(uid("tu"), url, fontFamily="$font.mono", size="$font.size.title", weight="600"),
            alert_msg(S["iso"], "neutral"),
            R(uid("al"), "btn-primary", descendants={"btn-primary-label": {"content": S["allow_land"]}}),
            stand_view(url),
            note(Q_LIVE),
        ],
    ))
    screens.append(app_screen(
        "08 Стенд — ТЛ",
        1280,
        "shell-tl",
        "stand",
        [
            page_title("Стенд"),
            T(uid("tc"), S["temp"], size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            T(uid("tu"), url, fontFamily="$font.mono", size="$font.size.title", weight="600"),
            alert_msg(S["iso"], "neutral"),
            R(uid("al"), "btn-primary", descendants={"btn-primary-label": {"content": S["allow_land"]}}),
            note(Q_TL_BTN),
            stand_view(url),
        ],
    ))
    screens.append(app_screen(
        "08 Стенд — действия разрешены",
        1080,
        "shell-qa",
        "stand",
        [
            page_title("Стенд"),
            T(uid("tc"), S["temp"], size="$font.size.caption", fill="$color.text.secondary", growth="fixed-width", width="fill_container"),
            T(uid("tu"), url, fontFamily="$font.mono", size="$font.size.title", weight="600"),
            R(uid("al"), "btn-primary", descendants={"btn-primary-label": {"content": S["allow_land"]}}),
            stand_view(url),
        ],
    ))
    screens.append(app_screen(
        "08 Стенд — временный URL не выдан",
        860,
        "shell-qa",
        "stand",
        [
            page_title("Стенд"),
            F(
                uid("emptyurl"),
                height=120,
                width="fill_container",
                fill="$color.surface",
                stroke="$color.border",
                strokeWidth=1,
                cornerRadius="$radius.lg",
            ),
            note(Q_URL),
        ],
    ))

    qa_rows = [
        ("07.10.2026 14:32", "359226", "Joint Relief", S["st_failed"], S["ai_ready"], S["lh_ok"]),
        ("06.10.2026 18:05", "359180", "Cardio Form", S["st_warn"], S["ai_ready"], S["lh_ok"]),
        ("05.10.2026 11:20", "358901", "Slim Tea", S["st_ok"], S["ai_err"], S["lh_err"]),
        ("04.10.2026 16:40", "359226", "Joint Relief", S["st_broke"], S["ai_wait"], S["lh_err"]),
    ]
    tl_rows = [
        ("07.10.2026 14:32", "359226", "Joint Relief", S["st_failed"], S["ai_ready"], S["lh_ok"], "qa.ivan"),
        ("06.10.2026 18:05", "359180", "Cardio Form", S["st_warn"], S["ai_ready"], S["lh_ok"], "qa.maria"),
        ("05.10.2026 11:20", "358901", "Slim Tea", S["st_ok"], S["ai_err"], S["lh_err"], "tl.admin"),
        ("04.10.2026 16:40", "359226", "Joint Relief", S["st_broke"], S["ai_wait"], S["lh_err"], "qa.ivan"),
    ]
    screens.append(app_screen("09 Список отчётов — QA", 780, "shell-qa", "reports", [page_title("Отчёты"), qa_report_table(qa_rows)]))
    screens.append(app_screen("09 Список отчётов — ТЛ", 780, "shell-tl", "reports", [page_title("Отчёты"), tl_report_table(tl_rows)]))

    screens.append(app_screen(
        "10 Затраты — цифры провайдера",
        860,
        "shell-tl",
        "costs",
        [
            page_title("Затраты"),
            R(
                uid("cc"),
                "card",
                width="fill_container",
                descendants={
                    "card-slot": {
                        "children": [
                            kv_ref("input", "18420", mono=True),
                            kv_ref("output", "3104", mono=True),
                            kv_ref("requests", "12", mono=True),
                            note(Q_COST),
                        ]
                    }
                },
            ),
        ],
    ))
    screens.append(app_screen(
        "10 Затраты — учёта нет",
        640,
        "shell-tl",
        "costs",
        [page_title("Затраты"), alert_msg(S["no_usage"], "neutral")],
    ))
    screens.append(app_screen("11 Админ-конфиг", 2280, "shell-tl", "config", config_body()))
    screens.append(app_screen(
        "12 Пользователи",
        980,
        "shell-tl",
        "users",
        [
            page_title(S["users"]),
            users_table(),
            user_form(),
        ],
    ))
    screens.append(app_screen(
        "12 Пользователи — логин уже есть",
        1080,
        "shell-tl",
        "users",
        [
            page_title(S["users"]),
            users_table(),
            user_form("admin", alert_msg(S["dup"])),
        ],
    ))
    return screens


def walk_ids(node, acc):
    if isinstance(node, dict):
        if "id" in node:
            acc.append(node["id"])
        for child in node.get("children") or []:
            walk_ids(child, acc)
        for value in (node.get("descendants") or {}).values():
            if isinstance(value, dict):
                if value.get("type") and value.get("id"):
                    walk_ids(value, acc)
                for child in value.get("children") or []:
                    walk_ids(child, acc)
    elif isinstance(node, list):
        for item in node:
            walk_ids(item, acc)


def walk_refs(node, refs):
    if isinstance(node, dict):
        if node.get("type") == "ref":
            refs.append((node.get("id"), node.get("ref")))
        for child in node.get("children") or []:
            walk_refs(child, refs)
        for value in (node.get("descendants") or {}).values():
            if isinstance(value, dict):
                for child in value.get("children") or []:
                    walk_refs(child, refs)
    elif isinstance(node, list):
        for item in node:
            walk_refs(item, refs)


def subtree(node, target):
    if isinstance(node, dict):
        if node.get("id") == target:
            return node
        for child in node.get("children") or []:
            found = subtree(child, target)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = subtree(item, target)
            if found:
                return found
    return None


def texts_of(node, acc):
    if isinstance(node, dict):
        if node.get("type") == "text":
            acc.append(node.get("content") or "")
        for child in node.get("children") or []:
            texts_of(child, acc)
        for value in (node.get("descendants") or {}).values():
            if isinstance(value, dict):
                if "content" in value:
                    acc.append(value["content"])
                for child in value.get("children") or []:
                    texts_of(child, acc)
    elif isinstance(node, list):
        for item in node:
            texts_of(item, acc)


def main():
    variables, colors = build_variables()
    kit_rows = build_kit(colors)
    screens = build_screens()
    wrapper = F(
        "canvas",
        name="Холст",
        layout="vertical",
        gap=40,
        x=0,
        y=0,
        width="fit_content",
        height="fit_content",
        children=[
            T("sec-kit", "UI-kit", size=28, weight="700"),
            *kit_rows,
            T("sec-screens", "Экраны", size=28, weight="700"),
            *screens,
        ],
    )
    doc = {"version": "2.20", "variables": variables, "children": [wrapper]}
    raw = json.dumps(doc, ensure_ascii=False, indent=2)
    OUT.write_text(raw, encoding="utf-8")

    ids = []
    walk_ids(doc, ids)
    dup = sorted({i for i in ids if ids.count(i) > 1})
    bad_slash = [i for i in ids if "/" in i]
    refs = []
    walk_refs(doc, refs)
    idset = set(ids)
    missing_refs = sorted({ref for _, ref in refs if ref not in idset})

    frames = []

    def collect_frames(node):
        if isinstance(node, dict):
            if node.get("type") == "frame" and node.get("name"):
                frames.append(node["name"])
            for child in node.get("children") or []:
                collect_frames(child)
        elif isinstance(node, list):
            for item in node:
                collect_frames(item)

    collect_frames(doc)
    screen_frames = [n for n in doc["children"][0]["children"] if isinstance(n, dict) and str(n.get("name", "")).startswith(("0", "1"))]
    bad_width = [n.get("name") for n in screen_frames if n.get("width") != 1440]

    missing_strings = [text for text in S.values() if text not in raw]
    for extra in ORDER + PREFIXES + MACROS + [
        "performance score", "First Contentful Paint", "Largest Contentful Paint",
        "Total Blocking Time", "Cumulative Layout Shift", "Speed Index", "Time to Interactive",
        "Preland w/ Form", "359226", "Lose 12 kg in 7 days without diet",
        "Проверка структуры", "mobile", "desktop",
    ]:
        if extra not in raw:
            missing_strings.append(extra)

    banned = []
    for phrase in ["не годен", "ленд плохой", "стало лучше", "стало хуже", "регресс", "merged", "Jira", "Telegram", "10 минут", "золотой", "суточн", "оплата по тарифу", "годен", "токен", "Bearer"]:
        if phrase in raw:
            banned.append(phrase)

    qa = subtree(doc, "shell-qa")
    qa_texts = []
    texts_of(qa, qa_texts)
    qa_blob = "\n".join(qa_texts)
    qa_forbidden = [w for w in ("Затраты", "Конфиг", "Пользователи") if w in qa_blob]
    tl = subtree(doc, "shell-tl")
    tl_texts = []
    texts_of(tl, tl_texts)
    tl_blob = "\n".join(tl_texts)
    tl_missing = [w for w in ("Затраты", "Конфиг", "Пользователи", S["as_tl"]) if w not in tl_blob]

    problems = []
    if dup:
        problems.append("duplicate ids: " + ", ".join(dup[:20]))
    if bad_slash:
        problems.append("slash in ids")
    if missing_refs:
        problems.append("missing refs: " + ", ".join(missing_refs))
    if bad_width:
        problems.append("width: " + ", ".join(bad_width))
    if missing_strings:
        problems.append("missing strings: " + " | ".join(missing_strings[:20]))
    if banned:
        problems.append("banned: " + ", ".join(banned))
    if qa_forbidden:
        problems.append("QA shell has: " + ", ".join(qa_forbidden))
    if tl_missing:
        problems.append("TL shell missing: " + ", ".join(tl_missing))
    if doc["version"] != "2.20":
        problems.append("version")

    names = [n.get("name") for n in screen_frames]
    kit_names = [n for n in frames if n.startswith("UI-kit")]
    print("FILE", OUT)
    print("BYTES", OUT.stat().st_size)
    print("IDS", len(ids))
    print("FRAMES", len(names))
    print("KIT")
    for name in kit_names:
        print("-", name)
    print("SCREENS")
    for name in names:
        print("-", name)
    if problems:
        print("PROBLEMS")
        for problem in problems:
            print("!", problem)
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
