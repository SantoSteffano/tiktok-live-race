FROM python:3.12-slim-bookworm

# Chromium рисует игру, Xvfb — виртуальный экран, pulseaudio — виртуальная
# звуковая карта, ffmpeg — захват и отправка в TikTok по RTMP.
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium xvfb pulseaudio ffmpeg curl \
        fonts-noto-color-emoji fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN useradd -m race && mkdir -p /app/data && chown -R race /app/data
USER race

ENV PYTHONUNBUFFERED=1
CMD ["bash", "stream/start.sh"]
