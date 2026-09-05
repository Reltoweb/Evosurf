#!/usr/bin/env bash
set -euo pipefail

REPO="${EVOSURF_RELEASE_REPOSITORY:-${EVOSURF_GITHUB_REPOSITORY:-Reltoweb/Evosurf}}"
INSTALL_DIR="${EVOSURF_INSTALL_DIR:-/opt/evosurf-viewer-headless}"
ASSET_PATTERN="${EVOSURF_RELEASE_ASSET_PATTERN:-evosurf-viewer-headless-linux.tar.gz}"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

if [ -z "$REPO" ]; then
  echo "EVOSURF_RELEASE_REPOSITORY is required, for example owner/public-releases-repo." >&2
  exit 1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

require_command curl
require_command tar
require_command npm
require_command python3

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

release_json="$tmp_dir/release.json"
archive="$tmp_dir/viewer.tar.gz"
extract_dir="$tmp_dir/extract"

curl -fsSL "$API_URL" -o "$release_json"

download_url="$(python3 - "$release_json" "$ASSET_PATTERN" <<'PY'
import json
import sys

release_path = sys.argv[1]
asset_pattern = sys.argv[2]

with open(release_path, "r", encoding="utf-8") as handle:
    release = json.load(handle)

for asset in release.get("assets", []):
    name = asset.get("name", "")
    if name == asset_pattern or (asset_pattern.startswith("evosurf-viewer-headless") and name.startswith("evosurf-viewer-headless-linux") and name.endswith(".tar.gz")):
        print(asset.get("browser_download_url", ""))
        break
PY
)"

if [ -z "$download_url" ]; then
  echo "No Linux headless release asset found in ${REPO} latest release." >&2
  exit 1
fi

mkdir -p "$extract_dir" "$INSTALL_DIR"
curl -fsSL "$download_url" -o "$archive"
tar -xzf "$archive" -C "$extract_dir"

shared_policy="$extract_dir/public/js/viewer-api-errors.js"
if [ ! -f "$shared_policy" ]; then
  echo "The Linux release archive is incomplete: public/js/viewer-api-errors.js is missing." >&2
  exit 1
fi

if [ -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env" "$tmp_dir/.env"
fi

rm -rf "$INSTALL_DIR/viewer-headless" "$INSTALL_DIR/electron"
cp -a "$extract_dir/viewer-headless" "$INSTALL_DIR/viewer-headless"
cp -a "$extract_dir/electron" "$INSTALL_DIR/electron"
mkdir -p "$INSTALL_DIR/public/js"
cp -a "$shared_policy" "$INSTALL_DIR/public/js/viewer-api-errors.js"

if [ -f "$tmp_dir/.env" ]; then
  cp "$tmp_dir/.env" "$INSTALL_DIR/.env"
fi

cd "$INSTALL_DIR/viewer-headless"
npm install --omit=dev
npx playwright install chromium >/dev/null

echo "EvoSurf headless updated in ${INSTALL_DIR}"
