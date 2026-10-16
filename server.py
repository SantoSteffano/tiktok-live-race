"""
Мост «TikTok LIVE → Roblox» для интерактивной гонки.

Сервер слушает чат стрима (комментарии, лайки, подписки, репосты, подарки),
переводит события в игровые действия по config.json и складывает их в
очередь. Игра в Roblox Studio (скрипты из папки roblox/) раз в полсекунды
забирает новые события по HTTP: GET /events?after=<номер последнего>.

    python server.py --tiktok ник_стримера   # живой стрим
    python server.py --demo                  # фейковые зрители для отладки
"""

import argparse
import asyncio
import json
import logging
import random
import re
from collections import deque
from pathlib import Path

from aiohttp import web

HERE = Path(__file__).parent
LONG_POLL_SECONDS = 5
ROBLOX_NAME = re.compile(r"^[A-Za-z0-9_]{3,20}$")

log = logging.getLogger("tiktok_live_race")


def load_config(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def describe(effect: dict) -> str:
    if effect["kind"] == "boost":
        return f"скорость ×{effect['multiplier']:g} на {effect['seconds']:g}с"
    return f"рывок вперёд на {effect['studs']}"


def legend(config: dict) -> list[str]:
    """Строки подсказки на экране игры: как вступить и что дают баффы."""
    join = config["join"]
    how = "любое сообщение" if join.get("any_comment", True) else f"«{join['keywords'][0]}»"
    lines = [f"💬 Напиши {how} — ты в забеге! Свой ник Roblox — бежишь в своём скине"]
    names = {"like": "👍 Лайк", "follow": "➕ Подписка", "share": "🔁 Репост"}
    for kind, title in names.items():
        if kind in config["effects"]:
            lines.append(f"{title}: {describe(config['effects'][kind])}")
    for name, effect in config.get("gifts_by_name", {}).items():
        lines.append(f"{effect['label'].split()[0]} {name.title()}: {describe(effect)}")
    tiers = sorted(config.get("gifts_by_diamonds", []), key=lambda t: t["min"])
    for tier in tiers[1:]:
        lines.append(f"{tier['label'].split()[0]} Подарок от {tier['min']}💎: {describe(tier)}")
    return lines


class Bridge:
    """Очередь событий, которую забирает игра в Roblox."""

    def __init__(self, config: dict):
        self.config = config
        self.events: deque[dict] = deque(maxlen=1000)
        self.seq = 0
        self.status = "запуск…"
        self.legend = legend(config)
        self.new_event = asyncio.Condition()

    async def push(self, msg: dict) -> None:
        self.seq += 1
        self.events.append({"seq": self.seq, **msg})
        log.info("→ %s", json.dumps(msg, ensure_ascii=False))
        async with self.new_event:
            self.new_event.notify_all()

    async def set_status(self, text: str) -> None:
        self.status = text
        log.info("статус: %s", text)

    def since(self, after: int) -> list[dict]:
        return [e for e in self.events if e["seq"] > after]

    async def handle_events(self, request: web.Request) -> web.Response:
        try:
            after = int(request.query.get("after", "-1"))
        except ValueError:
            after = -1
        # Игра только запустилась (after=-1) или мост перезапускали
        # (after > seq) — старые события не отдаём, только номер, с которого
        # начинать, чтобы не воскрешать зрителей, писавших полчаса назад.
        if after < 0 or after > self.seq:
            events = []
        else:
            events = self.since(after)
            if not events:
                try:
                    async with self.new_event:
                        await asyncio.wait_for(self.new_event.wait(), LONG_POLL_SECONDS)
                except asyncio.TimeoutError:
                    pass
                events = self.since(after)
        return web.json_response({
            "last": self.seq,
            "status": self.status,
            "legend": self.legend,
            "events": events,
        })

    async def handle_index(self, _: web.Request) -> web.Response:
        recent = "\n".join(json.dumps(e, ensure_ascii=False) for e in list(self.events)[-30:])
        body = (f"Мост гонки работает.\nСтатус: {self.status}\nСобытий: {self.seq}\n\n"
                f"Последние события:\n{recent}\n")
        return web.Response(text=body)


class EventMapper:
    """Переводит события стрима в сообщения для игры по config.json."""

    def __init__(self, config: dict, bridge: Bridge):
        self.config = config
        self.bridge = bridge

    def wants_to_join(self, text: str) -> bool:
        join = self.config["join"]
        if join.get("any_comment", True):
            return True
        words = text.lower().split()
        return any(k.lower() in words for k in join.get("keywords", []))

    def roblox_name(self, text: str) -> str | None:
        """Сообщение из одного слова латиницей похоже на ник Roblox."""
        text = text.strip().lstrip("@")
        keywords = {k.lower() for k in self.config["join"].get("keywords", [])}
        if ROBLOX_NAME.match(text) and text.lower() not in keywords:
            return text
        return None

    async def comment(self, user: dict, text: str) -> None:
        if self.wants_to_join(text):
            msg = {"type": "join", "user": user}
            if self.config.get("roblox_skins", True):
                name = self.roblox_name(text)
                if name:
                    msg["roblox"] = name
            await self.bridge.push(msg)

    async def social(self, user: dict, kind: str, count: int = 1) -> None:
        effect = self.config["effects"].get(kind)
        if effect:
            await self.bridge.push(
                {"type": "effect", "user": user, "effect": effect, "count": count}
            )

    def gift_effect(self, name: str, diamonds: int) -> dict | None:
        effect = self.config.get("gifts_by_name", {}).get(name.strip().lower())
        if effect:
            return effect
        tiers = sorted(self.config.get("gifts_by_diamonds", []), key=lambda t: t["min"])
        for tier in reversed(tiers):
            if diamonds >= tier["min"]:
                return tier
        return None

    async def gift(self, user: dict, name: str, diamonds: int, count: int) -> None:
        effect = self.gift_effect(name, diamonds)
        if not effect or count <= 0:
            return
        count = min(count, self.config.get("max_gift_repeat", 10))
        suffix = f"{name}×{count}" if count > 1 else name
        await self.bridge.push({
            "type": "effect", "user": user,
            "effect": {**effect, "label": f"{effect.get('label', '🎁')} ({suffix})"},
            "count": count,
        })


# --- TikTok -----------------------------------------------------------------

def tiktok_user(user) -> dict | None:
    if user is None:
        return None
    handle = user.unique_id or str(user.id)
    return {"id": handle, "name": user.nickname or handle}


async def run_tiktok(username: str, mapper: EventMapper, bridge: Bridge) -> None:
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
            await bridge.set_status(f"🔴 подключено к @{username}")

        @client.on(CommentEvent)
        async def on_comment(event: CommentEvent):
            user = tiktok_user(event.user)
            if user:
                await mapper.comment(user, event.content or "")

        @client.on(LikeEvent)
        async def on_like(event: LikeEvent):
            user = tiktok_user(event.user)
            if user:
                await mapper.social(user, "like", max(1, event.count or 1))

        @client.on(FollowEvent)
        async def on_follow(event: FollowEvent):
            user = tiktok_user(event.user)
            if user:
                await mapper.social(user, "follow")

        @client.on(ShareEvent)
        async def on_share(event: ShareEvent):
            user = tiktok_user(event.user)
            if user:
                await mapper.social(user, "share")

        @client.on(GiftEvent)
        async def on_gift(event: GiftEvent):
            user = tiktok_user(event.user)
            if not user or event.gift is None:
                return
            key = (user["id"], event.gift.id, event.group_id)
            total = max(1, event.repeat_count or 1)
            new = total - streaks.get(key, 0)
            if event.streaking:
                streaks[key] = total
            else:
                streaks.pop(key, None)
            await mapper.gift(user, event.gift.name or "gift",
                              event.gift.diamond_count or 0, new)

        @client.on(LiveEndEvent)
        async def on_end(_: LiveEndEvent):
            await bridge.set_status("стрим закончился")

        @client.on(DisconnectEvent)
        async def on_disconnect(_: DisconnectEvent):
            await bridge.set_status("отключено, переподключаюсь…")

        try:
            await bridge.set_status(f"подключаюсь к @{username}…")
            await client.connect()
        except UserOfflineError:
            await bridge.set_status(f"@{username} сейчас не в эфире — жду")
        except UserNotFoundError:
            await bridge.set_status(f"аккаунт @{username} не найден")
            return
        except Exception as ex:  # сеть, подпись запросов и т.п. — пробуем снова
            log.exception("ошибка TikTok")
            await bridge.set_status(f"ошибка TikTok: {type(ex).__name__}, повтор…")
        streaks.clear()
        await asyncio.sleep(20)


# --- Демо -------------------------------------------------------------------

# Несколько настоящих ников Roblox, чтобы в демо было видно скины.
DEMO_NAMES = [
    ("Котик_2010", None), ("Маша", "Builderman"), ("pro_gamer", None), ("Лёха", None),
    ("dasha.vlog", None), ("Тимур", "Roblox"), ("nika", None), ("Бабушка_Зина", None),
    ("Артём", None), ("ShadowFox", None), ("Вика", None), ("Илья", None),
    ("КРАШ", None), ("lola", None), ("Серёжа", None), ("Аня", None),
]
DEMO_GIFTS = [("Rose", 1), ("TikTok", 1), ("Finger Heart", 5),
              ("Doughnut", 30), ("Hat and Mustache", 99), ("Galaxy", 1000)]


async def run_demo(mapper: EventMapper, bridge: Bridge) -> None:
    await bridge.set_status("ДЕМО: фейковые зрители")
    users = [({"id": n, "name": n}, skin) for n, skin in DEMO_NAMES]
    joined: list[dict] = []
    while True:
        await asyncio.sleep(random.uniform(0.3, 1.2))
        roll = random.random()
        if roll < 0.25 or not joined:
            user, skin = random.choice(users)
            if user not in joined:
                joined.append(user)
            await mapper.comment(user, skin or "го")
        elif roll < 0.75:
            await mapper.social(random.choice(joined), "like", random.randint(1, 5))
        elif roll < 0.82:
            await mapper.social(random.choice(joined), "follow")
        elif roll < 0.87:
            await mapper.social(random.choice(joined), "share")
        else:
            name, diamonds = random.choices(DEMO_GIFTS, weights=[40, 25, 15, 10, 6, 1])[0]
            await mapper.gift(random.choice(joined), name, diamonds, random.randint(1, 3))


# --- Запуск -----------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Мост TikTok LIVE → Roblox для гонки")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--tiktok", metavar="НИК", help="ник стримера в TikTok (можно с @)")
    source.add_argument("--demo", action="store_true", help="фейковые зрители для отладки")
    parser.add_argument("--config", default=str(HERE / "config.json"))
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    config = load_config(Path(args.config))

    async def build_app() -> web.Application:
        bridge = Bridge(config)
        mapper = EventMapper(config, bridge)
        app = web.Application()
        app.router.add_get("/", bridge.handle_index)
        app.router.add_get("/events", bridge.handle_events)

        async def start_source(app_: web.Application):
            coro = run_demo(mapper, bridge) if args.demo else run_tiktok(args.tiktok, mapper, bridge)
            app_["source"] = asyncio.create_task(coro)

        async def stop_source(app_: web.Application):
            app_["source"].cancel()

        app.on_startup.append(start_source)
        app.on_cleanup.append(stop_source)
        return app

    port = args.port or config.get("port", 8765)
    print(f"\n  Мост запущен: http://localhost:{port}  (в RaceConfig.lua — BridgeUrl)\n")
    web.run_app(build_app(), host="127.0.0.1", port=port, print=None)


if __name__ == "__main__":
    main()
