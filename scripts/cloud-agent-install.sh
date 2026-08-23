#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for asciify-engine + asciify playground.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASCIFFY_DIR="${ASCIFFY_DIR:-/home/ubuntu/cloud-deps/asciify}"
ENGINE_LINK_DIR="${ENGINE_LINK_DIR:-/home/ubuntu/ayangabryl-projects}"
ASCIFFY_REPO="${ASCIFFY_REPO:-ayangabryl/asciify}"

cd "$ROOT"

echo "[cloud-agent-install] Installing asciify-engine dependencies..."
npm ci

echo "[cloud-agent-install] Building asciify-engine..."
npm run build

echo "[cloud-agent-install] Wiring local engine path for playground vite alias..."
mkdir -p "$ENGINE_LINK_DIR" "$(dirname "$ASCIFFY_DIR")"
ln -sfn "$ROOT" "$ENGINE_LINK_DIR/asciify-engine"

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

echo "[cloud-agent-install] Installing asciify playground dependencies..."
npm --prefix "$ASCIFFY_DIR" ci

ENGINE_ENTRY="$ENGINE_LINK_DIR/asciify-engine/src/index.ts"
if [[ ! -f "$ENGINE_ENTRY" ]]; then
  echo "[cloud-agent-install] ERROR: local engine entry missing at $ENGINE_ENTRY" >&2
  exit 1
fi

echo "[cloud-agent-install] Ready."
echo "  engine:     $ROOT"
echo "  playground: $ASCIFFY_DIR"
echo "  local link: $ENGINE_ENTRY"
