#!/usr/bin/env bash
# Облачная трансляция без монитора и OBS:
#   мост (server.py) → Chromium на виртуальном экране (Xvfb) → ffmpeg → RTMP TikTok.
#
# Переменные окружения (обычно из .env):
#   TIKTOK_USERNAME  ник стримера — откуда читать чат (или DEMO=1 для фейковых зрителей)
#   RTMP_URL         адрес сервера из TikTok (rtmp://…)
#   STREAM_KEY       ключ трансляции
#   OUTPUT           вместо RTMP записать в файл (для проверки), например /app/data/test.mp4
#   WIDTH/HEIGHT/FPS размер и частота кадров (по умолчанию 720×1280, 30)
#   VIDEO_BITRATE    по умолчанию 2500k
#   QUALITY          low (по умолчанию, без видеокарты) или high
set -euo pipefail
cd "$(dirname "$0")/.."

WIDTH=${WIDTH:-720}
HEIGHT=${HEIGHT:-1280}
FPS=${FPS:-30}
VIDEO_BITRATE=${VIDEO_BITRATE:-2500k}
QUALITY=${QUALITY:-low}
CHROMIUM=${CHROMIUM:-chromium}
PORT=${PORT:-8765}
DISPLAY_NUM=${DISPLAY_NUM:-99}
export DISPLAY=":${DISPLAY_NUM}"

if [[ -n "${OUTPUT:-}" ]]; then
  TARGET=("$OUTPUT")
  FORMAT=(-f mp4)
  [[ "$OUTPUT" == *.flv ]] && FORMAT=(-f flv)
else
  : "${RTMP_URL:?укажи RTMP_URL (адрес сервера из TikTok)}"
  : "${STREAM_KEY:?укажи STREAM_KEY (ключ трансляции из TikTok)}"
  TARGET=("${RTMP_URL%/}/${STREAM_KEY}")
  FORMAT=(-f flv)
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

log() { echo "[$(date +%H:%M:%S)] $*"; }

# 1. мост
if [[ "${DEMO:-0}" == "1" ]]; then
  python server.py --demo --port "$PORT" &
else
  : "${TIKTOK_USERNAME:?укажи TIKTOK_USERNAME или DEMO=1}"
  python server.py --tiktok "$TIKTOK_USERNAME" --port "$PORT" &
fi
pids+=($!)

# 2. виртуальный экран и виртуальная звуковая карта
Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x24" -nolisten tcp &
pids+=($!)
AUDIO_IN=(-f lavfi -i anullsrc=r=44100:cl=stereo)
if command -v pulseaudio >/dev/null; then
  pulseaudio -D --exit-idle-time=-1 --log-target=stderr 2>/dev/null || true
  for _ in $(seq 20); do pactl info >/dev/null 2>&1 && break; sleep 0.25; done
  if pactl info >/dev/null 2>&1; then
    pactl load-module module-null-sink sink_name=game sink_properties=device.description=game >/dev/null
    pactl set-default-sink game
    AUDIO_IN=(-f pulse -i game.monitor)
  fi
fi
[[ "${AUDIO_IN[1]}" == "pulse" ]] && log "звук: pulseaudio" || log "ВНИМАНИЕ: pulseaudio нет — трансляция будет без звука"

for _ in $(seq 40); do curl -fs "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 0.25; done

# 3. браузер с игрой (перезапускается, если упадёт)
(
  while true; do
    "$CHROMIUM" --no-sandbox --kiosk --no-first-run --disable-infobars --disable-translate \
      --disable-features=Translate,MediaRouter --noerrdialogs --disable-dev-shm-usage \
      --autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist --enable-unsafe-swiftshader \
      --window-position=0,0 --window-size="${WIDTH},${HEIGHT}" \
      --user-data-dir=/tmp/race-chrome \
      "http://127.0.0.1:$PORT/?quality=${QUALITY}&nohint" >/tmp/chromium.log 2>&1 || true
    log "браузер закрылся — перезапускаю"
    sleep 2
  done
) &
pids+=($!)
sleep 6

# 4. захват экрана и звука → RTMP (перезапуск при обрыве связи)
while true; do
  log "трансляция → ${OUTPUT:-RTMP}"
  ffmpeg -hide_banner -loglevel warning -stats \
    -thread_queue_size 512 -f x11grab -draw_mouse 0 -framerate "$FPS" -video_size "${WIDTH}x${HEIGHT}" -i "$DISPLAY" \
    -thread_queue_size 512 "${AUDIO_IN[@]}" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_BITRATE" -bufsize 5000k -g $((FPS * 2)) \
    -c:a aac -b:a 160k -ar 44100 \
    ${DURATION:+-t "$DURATION"} \
    "${FORMAT[@]}" "${TARGET[@]}" || true
  [[ -n "${OUTPUT:-}" ]] && break
  log "ffmpeg остановился — переподключаюсь через 5 с"
  sleep 5
done
