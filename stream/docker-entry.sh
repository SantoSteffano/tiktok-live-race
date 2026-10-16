#!/usr/bin/env bash
# Точка входа контейнера: папки data/ и music/ подключаются с сервера и
# принадлежат root — отдаём data/ пользователю race и запускаем трансляцию от него.
set -e
mkdir -p /app/data /app/music
chown -R race:race /app/data
exec su race -s /bin/bash -c "cd /app && exec bash stream/start.sh"
