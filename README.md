# Гонка чата: TikTok LIVE → Roblox

Интерактивный стрим: в Roblox бегут человечки, а участники — зрители
TikTok-эфира.

- **Написал в чат** — твой бегун появился на старте (в лобби перед забегом).
- **Написал свой ник Roblox** (одним словом латиницей) — бежишь в своём скине.
  Скин запоминается до конца стрима.
- **Лайк, подписка, репост, подарок** — бафф: ускорение или рывок вперёд.
  Что именно даёт каждый подарок — в `config.json`, подсказка по баффам
  выводится прямо на экран игры.
- Если зрителей мало, места добирают боты. Живой зритель вытесняет бота.
- Кто написал во время забега — встаёт в очередь на следующий, и его подарки
  тоже не пропадают: сработают на старте следующего забега.

```
TikTok LIVE ──► server.py (мост) ──HTTP──► Roblox Studio (игра) ──► OBS ──► эфир
 чат, лайки,     переводит события        трасса, бегуны,
 подарки         в баффы по config.json   камера, табло
```

## Что внутри

| Файл | Что делает |
|---|---|
| `server.py` | Мост. Слушает эфир через неофициальную библиотеку [TikTokLive](https://github.com/isaackogan/TikTokLive), отдаёт события игре на `GET /events`. Есть демо-режим с фейковыми зрителями. |
| `config.json` | Как вступить в забег и что даёт каждый лайк/подписка/подарок. |
| `roblox/ChatRace.rbxlx` | Готовое место для Roblox Studio — открыл и играешь. |
| `roblox/RaceConfig.lua` | Настройки игры: длина трассы, время лобби, максимум бегунов, камера. |
| `roblox/RaceServer.server.lua` | Игра: строит трассу, проводит забеги, применяет баффы. |
| `roblox/RaceClient.client.lua` | Камера за бегунами и надписи на экране. |

## Запуск

### 1. Мост

Нужен Python 3.10+.

```bash
git clone https://github.com/SantoSteffano/tiktok-live-race.git
cd tiktok-live-race
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

python server.py --demo           # сначала проверь с фейковыми зрителями
python server.py --tiktok твой_ник  # потом — на живом эфире (эфир уже должен идти)
```

Открой в браузере http://localhost:8765 — там видно статус и последние события.

### 2. Игра

1. Установи [Roblox Studio](https://create.roblox.com/) и войди в аккаунт.
2. Открой `roblox/ChatRace.rbxlx` (File → Open from File).
3. Проверь, что HTTP включён: **Home → Game Settings → Security → Allow HTTP
   Requests**. Если выключен — включи и сохрани место (Studio может
   попросить сначала опубликовать его, это бесплатно).
4. Нажми **Play** (F5). Пока мост в демо-режиме, бегуны начнут появляться сами.

Без файла `.rbxlx` можно и вручную: создай в пустом месте ModuleScript
`RaceConfig` в ReplicatedStorage, Script `RaceServer` в ServerScriptService,
LocalScript `RaceClient` в StarterPlayer → StarterPlayerScripts и вставь в них
код из одноимённых `.lua`-файлов. В Players выключи `CharacterAutoLoads`.

### 3. Трансляция

TikTok-эфир с компьютера идёт через **TikTok LIVE Studio** или через OBS
со stream key (ключ дают не всем аккаунтам). В обоих случаях:

- добавь источник «Захват окна» → окно Roblox Studio;
- сделай окно Studio вертикальным (узким и высоким), чтобы кадр был 9:16, —
  камера и надписи подстраиваются. Наклон и отдаление камеры —
  `CameraBack` / `CameraHeight` в `RaceConfig.lua`.

## Настройка баффов (`config.json`)

```json
"effects": {
  "like":   {"kind": "boost", "multiplier": 1.15, "seconds": 1.0, "label": "👍 лайк"},
  "follow": {"kind": "boost", "multiplier": 2.0,  "seconds": 5.0, "label": "➕ подписка — турбо!"},
  "share":  {"kind": "jump",  "studs": 25, "label": "🔁 репост — рывок!"}
}
```

- `boost` — скорость ×`multiplier` на `seconds` секунд. Несколько бустов
  складываются, но не больше `MaxSpeedMultiplier` из `RaceConfig.lua`.
- `jump` — рывок (джетпак) вперёд на `studs` (трасса — 500).
- `gifts_by_name` — конкретные подарки по английскому названию из TikTok
  (`rose`, `tiktok`, `finger heart`…).
- `gifts_by_diamonds` — все остальные подарки по цене в алмазах: берётся
  самый дорогой подходящий уровень.
- Серия подарков («комбо ×5») срабатывает сразу на каждый подарок, но не
  больше `max_gift_repeat` за раз.
- `join.any_comment: false` — тогда вступать только по словам из
  `join.keywords` («го», «+», …).

После правки `config.json` перезапусти мост; правки `RaceConfig.lua` — в Studio
(или пересобери `.rbxlx`: `rojo build roblox/default.project.json -o roblox/ChatRace.rbxlx`).

## Важно знать

- **TikTokLive — неофициальная библиотека.** TikTok может её сломать
  обновлением; тогда обнови пакет: `pip install -U TikTokLive`. При большом
  количестве подключений библиотека может попросить ключ сервиса подписи
  (Euler Stream) — сообщение об этом будет в консоли моста.
- **Мост работает только с Roblox Studio на том же компьютере** (адрес
  `localhost`). Опубликованная игра на серверах Roblox до твоего компьютера
  не достучится — для неё нужен публичный адрес (туннель вроде `cloudflared`
  или сервер), его прописывают в `BridgeUrl`.
- Ник Roblox ищется по любому сообщению из одного латинского слова, поэтому
  слово вроде `hello` тоже может найти чей-то скин. Ничего страшного, но
  если мешает — выключи `"roblox_skins": false`.
