#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_linux
require_systemctl
run_cmd nginx -t
run_cmd systemctl reload nginx
run_cmd systemctl status nginx --no-pager
