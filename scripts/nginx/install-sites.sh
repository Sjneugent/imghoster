#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_linux
require_systemctl

MODE="${1:-secure}"
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
SITES_AVAILABLE="${NGINX_DIR}/sites-available"
SITES_ENABLED="${NGINX_DIR}/sites-enabled"

SECURE_SRC="${ROOT_DIR}/nginx/imghoster.conf"
INSECURE_SRC="${ROOT_DIR}/nginx/imghoster-insecure.conf"
SECURE_DEST="${SITES_AVAILABLE}/imghoster.conf"
INSECURE_DEST="${SITES_AVAILABLE}/imghoster-insecure.conf"
SECURE_LINK="${SITES_ENABLED}/imghoster.conf"
INSECURE_LINK="${SITES_ENABLED}/imghoster-insecure.conf"

if [[ ! -f "${SECURE_SRC}" ]]; then
  echo "Missing secure nginx config: ${SECURE_SRC}" >&2
  exit 1
fi
if [[ ! -f "${INSECURE_SRC}" ]]; then
  echo "Missing insecure nginx config: ${INSECURE_SRC}" >&2
  exit 1
fi

case "${MODE}" in
  secure|insecure) ;;
  *)
    echo "Usage: $0 [secure|insecure]" >&2
    exit 1
    ;;
esac

echo "Installing nginx site configs into ${SITES_AVAILABLE}"
run_cmd mkdir -p "${SITES_AVAILABLE}" "${SITES_ENABLED}"
run_cmd cp "${SECURE_SRC}" "${SECURE_DEST}"
run_cmd cp "${INSECURE_SRC}" "${INSECURE_DEST}"

if [[ "${MODE}" == "secure" ]]; then
  echo "Enabling secure config"
  run_cmd ln -sfn "${SECURE_DEST}" "${SECURE_LINK}"
  run_cmd rm -f "${INSECURE_LINK}"
else
  echo "Enabling insecure config"
  run_cmd ln -sfn "${INSECURE_DEST}" "${INSECURE_LINK}"
  run_cmd rm -f "${SECURE_LINK}"
fi

run_cmd nginx -t
run_cmd systemctl reload nginx

echo "Done. Active mode: ${MODE}"
