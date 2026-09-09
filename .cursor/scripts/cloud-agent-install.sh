#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOME}/ayangabryl-projects"
ENGINE_DIR="${ROOT}/asciify-engine"
FRONTEND_DIR="${ROOT}/asciify"
FRONTEND_REPO="https://github.com/ayangabryl/asciify"

mkdir -p "${ROOT}"

# Primary repo checkout lives at /workspace; expose it where the frontend expects it.
if [[ ! -e "${ENGINE_DIR}" ]]; then
  ln -sfn /workspace "${ENGINE_DIR}"
fi

if [[ ! -d "${FRONTEND_DIR}/.git" ]]; then
  git clone "${FRONTEND_REPO}" "${FRONTEND_DIR}"
fi

echo "Installing asciify-engine dependencies..."
(cd /workspace && npm ci)
echo "Building asciify-engine..."
(cd /workspace && npm run build)

echo "Installing asciify frontend dependencies..."
(cd "${FRONTEND_DIR}" && npm ci)

echo "Cloud Agent install complete."
