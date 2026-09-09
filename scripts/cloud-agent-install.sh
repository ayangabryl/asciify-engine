#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for asciify-engine + asciify playground.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASCIFFY_DIR="${ASCIFFY_DIR:-/home/ubuntu/cloud-deps/asciify}"
ASCIFFY_REPO="${ASCIFFY_REPO:-ayangabryl/asciify}"
# Legacy path used by asciify's vite.config local-engine alias. Keep it absent
# so Vite resolves asciify-engine from node_modules (linked to this repo).
LEGACY_ENGINE_LINK="${LEGACY_ENGINE_LINK:-/home/ubuntu/ayangabryl-projects/asciify-engine}"

cd "$ROOT"

echo "[cloud-agent-install] Installing asciify-engine dependencies..."
npm ci

echo "[cloud-agent-install] Building asciify-engine..."
npm run build

mkdir -p "$(dirname "$ASCIFFY_DIR")"

if [[ ! -d "$ASCIFFY_DIR/.git" ]]; then
  echo "[cloud-agent-install] Cloning ${ASCIFFY_REPO} into ${ASCIFFY_DIR}..."
  rm -rf "$ASCIFFY_DIR"
  gh repo clone "$ASCIFFY_REPO" "$ASCIFFY_DIR" -- --depth 1
else
  echo "[cloud-agent-install] Updating ${ASCIFFY_REPO} at ${ASCIFFY_DIR}..."
  git -C "$ASCIFFY_DIR" fetch --depth 1 origin HEAD
  DEFAULT_BRANCH="$(git -C "$ASCIFFY_DIR" remote show origin | awk '/HEAD branch/ {print $NF}')"
  git -C "$ASCIFFY_DIR" checkout -B "$DEFAULT_BRANCH" "origin/${DEFAULT_BRANCH}"
fi

# Avoid the out-of-root vite alias path (blocked by Vite server.fs.allow).
if [[ -L "$LEGACY_ENGINE_LINK" || -e "$LEGACY_ENGINE_LINK" ]]; then
  echo "[cloud-agent-install] Removing legacy local-engine path ${LEGACY_ENGINE_LINK}..."
  rm -f "$LEGACY_ENGINE_LINK"
fi

echo "[cloud-agent-install] Installing asciify playground dependencies..."
npm --prefix "$ASCIFFY_DIR" ci

echo "[cloud-agent-install] Linking local asciify-engine into playground node_modules..."
rm -rf "$ASCIFFY_DIR/node_modules/asciify-engine"
ln -sfn "$ROOT" "$ASCIFFY_DIR/node_modules/asciify-engine"

if [[ ! -f "$ASCIFFY_DIR/node_modules/asciify-engine/dist/index.js" ]]; then
  echo "[cloud-agent-install] ERROR: linked engine dist missing" >&2
  exit 1
fi

echo "[cloud-agent-install] Ready."
echo "  engine:     $ROOT"
echo "  playground: $ASCIFFY_DIR"
echo "  linked pkg: $ASCIFFY_DIR/node_modules/asciify-engine -> $ROOT"
