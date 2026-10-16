"""
Гонка чата для TikTok LIVE.

Сервер слушает эфир (комментарии, лайки, подписки, репосты, подарки),
переводит события в игровые действия по config.json и рассылает их странице
с 3D-гонкой (web/index.html) через WebSocket. Ещё он считает АУРУ зрителей
и сохраняет её между эфирами в data/aura.json.

    python server.py --tiktok ник_стримера   # живой эфир
    python server.py --demo                  # фейковые зрители для отладки
"""

import sys

if sys.version_info < (3, 10):
    sys.exit(f"Нужен Python 3.10 или новее, а запущен {sys.version.split()[0]}.\n"
             "Поставь свежий с https://www.python.org/downloads/ и пересоздай окружение:\n"
             "  rm -rf venv && python3.12 -m venv venv && source venv/bin/activate\n"
             "  pip install -r requirements.txt")

import argparse
import asyncio
import json
import logging
import random
import re
from pathlib import Path

from aiohttp import WSMsgType, web

HERE = Path(__file__).parent
WEB = HERE / "web"
DATA = HERE / "data"
MUSIC = HERE / "music"
MUSIC_EXT = {".mp3", ".ogg", ".m4a", ".wav", ".aac", ".opus"}

log = logging.getLogger("tiktok_live_race")


def load_config(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Aura:
    """Очки ауры зрителей: копятся за лайки, подарки и победы, хранятся на диске."""

    def __init__(self, config: dict, path: Path):
        self.config = config
        self.path = path
        self.users: dict[str, dict] = {}
        if path.exists():
            try:
                self.users = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                log.warning("не удалось прочитать %s, начинаю с нуля", path)
        self._dirty = False

    def title(self, points: int) -> str:
        title = ""
        for need, name in self.config["titles"]:
            if points >= need:
                title = name
        return title

    def user(self, uid: str, name: str) -> dict:
        entry = self.users.setdefault(uid, {"name": name, "aura": 0})
        entry["name"] = name
        return {"id": uid, "name": name, "aura": entry["aura"], "title": self.title(entry["aura"])}

    def add(self, uid: str, name: str, points: int) -> dict:
        entry = self.users.setdefault(uid, {"name": name, "aura": 0})
        entry["aura"] += int(points)
        self._dirty = True
        return self.user(uid, name)

    def top(self, n: int = 5) -> list[dict]:
        best = sorted(self.users.items(), key=lambda kv: kv[1]["aura"], reverse=True)[:n]
        return [{"name": e["name"], "aura": e["aura"], "title": self.title(e["aura"])}
                for _, e in best if e["aura"] > 0]

    async def autosave(self) -> None:
        while True:
            await asyncio.sleep(5)
            if self._dirty:
                self._dirty = False
                self.path.parent.mkdir(exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(self.users, ensure_ascii=False), encoding="utf-8")
                tmp.replace(self.path)


class Hub:
    """Все открытые страницы с гонкой (в облаке — одна, плюс превью)."""

    def __init__(self, config: dict, aura: Aura):
        self.config = config
        self.aura = aura
        self.clients: set[web.WebSocketResponse] = set()
        self.status = "запуск…"

    async def broadcast(self, msg: dict) -> None:
        data = json.dumps(msg, ensure_ascii=False)
        for ws in list(self.clients):
            try:
                await ws.send_str(data)
            except ConnectionError:
                self.clients.discard(ws)

    async def set_status(self, text: str) -> None:
        self.status = text
        log.info("статус: %s", text)
        await self.broadcast({"type": "status", "text": text})

    async def send_top(self) -> None:
        await self.broadcast({"type": "aura_top", "top": self.aura.top()})

    async def handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=20)
        await ws.prepare(request)
        self.clients.add(ws)
        await ws.send_json({"type": "config", "config": self.config})
        await ws.send_json({"type": "status", "text": self.status})
        await ws.send_json({"type": "aura_top", "top": self.aura.top()})
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    await self.on_page_message(json.loads(msg.data))
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            self.clients.discard(ws)
        return ws

    async def on_page_message(self, msg: dict) -> None:
        # Страница сообщает о победе — начисляем ауру победителю.
        if msg.get("type") == "win" and msg.get("id"):
            user = self.aura.add(msg["id"], msg.get("name", msg["id"]),
                                 self.config["aura"].get("per_win", 0))
            await self.broadcast({"type": "user", "user": user})
            await self.send_top()


class EventMapper:
    """Переводит события эфира в сообщения для страницы по config.json."""

    def __init__(self, config: dict, hub: Hub):
        self.config = config
        self.hub = hub
        self.aura = hub.aura
        emotes = config.get("emotes", {})
        self.word_emotes = {k.lower(): v for k, v in emotes.items() if re.fullmatch(r"\w+", k)}
        self.char_emotes = {k: v for k, v in emotes.items() if not re.fullmatch(r"\w+", k)}

    def wants_to_join(self, text: str) -> bool:
        join = self.config["join"]
        if join.get("any_comment", True):
            return True
        words = text.lower().split()
        return any(k.lower() in words for k in join.get("keywords", []))

    def emote(self, text: str) -> str | None:
        for key, emoji in self.char_emotes.items():
            if key in text:
                return emoji
        for word in re.findall(r"\w+", text.lower()):
            if word in self.word_emotes:
                return self.word_emotes[word]
        return None

    async def comment(self, uid: str, name: str, text: str) -> None:
        user = self.aura.user(uid, name)
        if self.wants_to_join(text):
            await self.hub.broadcast({"type": "join", "user": user})
        emoji = self.emote(text)
        if emoji:
            await self.hub.broadcast({"type": "emote", "user": user, "emoji": emoji})

    async def social(self, uid: str, name: str, kind: str, count: int = 1) -> None:
        user = self.aura.add(uid, name, self.config["aura"].get(f"per_{kind}", 0) * count)
        effect = self.config["effects"].get(kind)
        if effect:
            await self.hub.broadcast({"type": "effect", "user": user, "effect": effect,
                                      "count": count, "source": kind})

    def gift_effect(self, name: str, diamonds: int) -> dict | None:
        effect = self.config.get("gifts_by_name", {}).get(name.strip().lower())
        if effect:
            return effect
        tiers = sorted(self.config.get("gifts_by_diamonds", []), key=lambda t: t["min"])
        for tier in reversed(tiers):
            if diamonds >= tier["min"]:
                return tier
        return None

    async def gift(self, uid: str, name: str, gift: str, diamonds: int, count: int) -> None:
        if count <= 0:
            return
        user = self.aura.add(uid, name, self.config["aura"].get("per_diamond", 0) * diamonds * count)
        effect = self.gift_effect(gift, diamonds)
        if effect:
            count = min(count, self.config.get("max_gift_repeat", 10))
            suffix = f"{gift}×{count}" if count > 1 else gift
            await self.hub.broadcast({
                "type": "effect", "user": user, "source": "gift", "count": count,
                "diamonds": diamonds * count,
                "effect": {**effect, "label": f"{effect.get('label', '🎁')} ({suffix})"},
            })
        await self.hub.send_top()


# --- TikTok -----------------------------------------------------------------

def tiktok_user(user) -> tuple[str, str] | None:
    if user is None:
        return None
    handle = user.unique_id or str(user.id)
    return handle, (user.nickname or handle)


async def run_tiktok(username: str, mapper: EventMapper, hub: Hub) -> None:
    from TikTokLive import TikTokLiveClient
    from TikTokLive.client.errors import UserNotFoundError, UserOfflineError
    from TikTokLive.events import (
        CommentEvent, ConnectEvent, DisconnectEvent, FollowEvent, GiftEvent,
        LikeEvent, LiveEndEvent, ShareEvent,
    )

    username = username.lstrip("@")
    # Серия одинаковых подарков («комбо») приходит пачкой событий с растущим
    # repeat_count. Баффаем сразу на каждый прирост, а не в конце серии,
    # чтобы зритель видел реакцию моментально.
    streaks: dict[tuple, int] = {}

    while True:
        client = TikTokLiveClient(unique_id=username)

        @client.on(ConnectEvent)
        async def on_connect(_: ConnectEvent):
            await hub.set_status(f"🔴 подключено к @{username}")

        @client.on(CommentEvent)
        async def on_comment(event: CommentEvent):
            who = tiktok_user(event.user)
            if who:
                await mapper.comment(*who, event.content or "")

        @client.on(LikeEvent)
        async def on_like(event: LikeEvent):
            who = tiktok_user(event.user)
            if who:
                await mapper.social(*who, "like", max(1, event.count or 1))

        @client.on(FollowEvent)
        async def on_follow(event: FollowEvent):
            who = tiktok_user(event.user)
            if who:
                await mapper.social(*who, "follow")

        @client.on(ShareEvent)
        async def on_share(event: ShareEvent):
            who = tiktok_user(event.user)
            if who:
                await mapper.social(*who, "share")

        @client.on(GiftEvent)
        async def on_gift(event: GiftEvent):
            who = tiktok_user(event.user)
            if not who or event.gift is None:
                return
            key = (who[0], event.gift.id, event.group_id)
            total = max(1, event.repeat_count or 1)
            new = total - streaks.get(key, 0)
            if event.streaking:
                streaks[key] = total
            else:
                streaks.pop(key, None)
            await mapper.gift(*who, event.gift.name or "gift", event.gift.diamond_count or 0, new)

        @client.on(LiveEndEvent)
        async def on_end(_: LiveEndEvent):
            await hub.set_status("эфир закончился")

        @client.on(DisconnectEvent)
        async def on_disconnect(_: DisconnectEvent):
            await hub.set_status("отключено, переподключаюсь…")

        try:
            await hub.set_status(f"подключаюсь к @{username}…")
            await client.connect()
        except UserOfflineError:
            await hub.set_status(f"@{username} сейчас не в эфире — жду")
        except UserNotFoundError:
            await hub.set_status(f"аккаунт @{username} не найден")
            return
        except Exception as ex:  # сеть, подпись запросов и т.п. — пробуем снова
            log.exception("ошибка TikTok")
            await hub.set_status(f"ошибка TikTok: {type(ex).__name__}, повтор…")
        streaks.clear()
        await asyncio.sleep(20)


# --- Демо -------------------------------------------------------------------

DEMO_NAMES = [
    "Котик_2010", "Маша", "pro_gamer", "Лёха", "dasha.vlog", "Тимур", "nika",
    "Бабушка_Зина", "Артём", "ShadowFox", "Вика", "Илья", "КРАШ", "lola",
    "Серёжа", "minecraft_king", "Аня", "Олег", "sasha_k", "Дед_Инсайд",
]
DEMO_COMMENTS = ["го", "+", "я", "го го го", "🗿", "сигма", "💀", "скибиди", "67", "аура",
                 "имба", "ахах", "gg", "😎", "🤡", "кто выиграет?", "давай!"]
DEMO_GIFTS = [("Rose", 1), ("TikTok", 1), ("Finger Heart", 5), ("Doughnut", 30),
              ("Hat and Mustache", 99), ("Galaxy", 1000)]


async def run_demo(mapper: EventMapper, hub: Hub) -> None:
    await hub.set_status("ДЕМО: фейковые зрители")
    joined: list[str] = []
    while True:
        await asyncio.sleep(random.uniform(0.25, 1.0))
        roll = random.random()
        if roll < 0.3 or not joined:
            name = random.choice(DEMO_NAMES)
            if name not in joined:
                joined.append(name)
            await mapper.comment(name, name, random.choice(DEMO_COMMENTS))
        elif roll < 0.72:
            name = random.choice(joined)
            await mapper.social(name, name, "like", random.randint(1, 5))
        elif roll < 0.78:
            name = random.choice(joined)
            await mapper.social(name, name, "follow")
        elif roll < 0.83:
            name = random.choice(joined)
            await mapper.social(name, name, "share")
        else:
            gift, diamonds = random.choices(DEMO_GIFTS, weights=[45, 28, 15, 7, 4, 1])[0]
            name = random.choice(joined)
            await mapper.gift(name, name, gift, diamonds, random.randint(1, 3))


# --- Запуск -----------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Гонка чата для TikTok LIVE")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--tiktok", metavar="НИК", help="ник стримера в TikTok (можно с @)")
    source.add_argument("--demo", action="store_true", help="фейковые зрители для отладки")
    parser.add_argument("--config", default=str(HERE / "config.json"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    config = load_config(Path(args.config))

    async def build_app() -> web.Application:
        aura = Aura(config, DATA / "aura.json")
        hub = Hub(config, aura)
        mapper = EventMapper(config, hub)

        app = web.Application()
        app.router.add_get("/ws", hub.handle_ws)
        app.router.add_get("/", lambda _: web.FileResponse(WEB / "index.html"))
        app.router.add_static("/web", WEB)
        MUSIC.mkdir(exist_ok=True)
        app.router.add_get("/music/list", lambda _: web.json_response(
            sorted(f.name for f in MUSIC.iterdir() if f.suffix.lower() in MUSIC_EXT)))
        app.router.add_static("/music", MUSIC)

        async def start(app_: web.Application):
            source = run_demo(mapper, hub) if args.demo else run_tiktok(args.tiktok, mapper, hub)
            app_["tasks"] = [asyncio.create_task(source), asyncio.create_task(aura.autosave())]

        async def stop(app_: web.Application):
            for task in app_["tasks"]:
                task.cancel()

        app.on_startup.append(start)
        app.on_cleanup.append(stop)
        return app

    port = args.port or config.get("port", 8765)
    print(f"\n  Гонка: http://localhost:{port}  (в OBS — «Браузер», 1080×1920)\n")
    web.run_app(build_app(), host=args.host, port=port, print=None)


if __name__ == "__main__":
    main()
