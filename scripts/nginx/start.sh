#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

require_linux
require_systemctl
run_cmd systemctl start nginx
run_cmd systemctl status nginx --no-pager
