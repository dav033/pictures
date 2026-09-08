#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/home/ec2-user/demo-decoracion
DATA_VOLUME=demo-decoracion-data
IMAGE=demo-decoracion:latest
DEPLOY_SHA=${1:-}

# authorized_keys ejecuta este script como comando forzado. En ese caso SSH
# conserva el comando solicitado por Actions en SSH_ORIGINAL_COMMAND.
if [[ -z "$DEPLOY_SHA" && ${SSH_ORIGINAL_COMMAND:-} =~ ([0-9a-f]{40}) ]]; then
  DEPLOY_SHA=${BASH_REMATCH[1]}
fi

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected an exact 40-character deployment SHA." >&2
  exit 2
fi

cd "$APP_DIR"

git fetch --depth 50 origin main
if ! git cat-file -e "$DEPLOY_SHA^{commit}" 2>/dev/null; then
  git fetch --depth 1 origin "$DEPLOY_SHA"
fi
if ! git merge-base --is-ancestor "$DEPLOY_SHA" origin/main; then
  echo "Refusing SHA outside origin/main: $DEPLOY_SHA" >&2
  exit 3
fi
git checkout "$DEPLOY_SHA" -- .

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
