#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/home/ec2-user/demo-decoracion
DATA_VOLUME=demo-decoracion-data
IMAGE=demo-decoracion:latest

cd "$APP_DIR"

git fetch --depth 1 origin main
git checkout FETCH_HEAD -- .

docker build -t "$IMAGE" .

docker stop demo-decoracion || true
docker rm demo-decoracion || true

# El volumen conserva datos runtime. Solo se sobreescribe/añade el contenido
# versionado de data; archivos persistentes no presentes en el checkout quedan.
docker volume create "$DATA_VOLUME" >/dev/null
docker run --rm --user 0:0 \
  --mount "type=volume,src=$DATA_VOLUME,dst=/target" \
  --mount "type=bind,src=$APP_DIR/data,dst=/source,readonly" \
  node:22-alpine sh -c 'cp -a /source/. /target/'

docker run -d --name demo-decoracion \
  --network stack_web \
  --restart unless-stopped \
  --env-file .env.production \
  -v "$DATA_VOLUME:/app/data" \
  "$IMAGE"

docker image prune -f
