#!/usr/bin/env bash
set -euo pipefail

run_cmd() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

require_linux() {
  case "$(uname -s)" in
    Linux) ;;
    *)
      echo "This script is intended to run on Linux." >&2
      exit 1
      ;;
  esac
}

require_systemctl() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found. This script expects a systemd-based system." >&2
    exit 1
  fi
}
