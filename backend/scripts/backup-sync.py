#!/usr/bin/env python3
"""
Backup sync script for ImgHoster.

Copies local database backups (data/backups/) to a remote destination via one of:
  - rsync   (SSH-based transfer to another machine)
  - rclone  (Google Drive, S3, Dropbox, etc.)
  - cp      (plain copy to a mounted volume or local path)

Usage:
  python3 scripts/backup-sync.py                     # uses env / .env defaults
  python3 scripts/backup-sync.py --method rsync      # override method
  python3 scripts/backup-sync.py --dry-run            # preview without copying

Environment variables (also read from ../.env):
  BACKUP_SYNC_METHOD      rsync | rclone | copy          (default: copy)
  BACKUP_SYNC_SOURCE      local backup dir                (default: ./data/backups)
  BACKUP_SYNC_DEST        destination path or remote spec (required)
  BACKUP_SYNC_RCLONE_REMOTE  rclone remote name           (e.g. gdrive:imghoster-backups)
  BACKUP_SYNC_RSYNC_HOST     rsync host spec               (e.g. user@host:/backups)
  BACKUP_SYNC_RSYNC_KEY      SSH key path for rsync        (optional)
  BACKUP_SYNC_MAX_AGE_DAYS   only sync files newer than N days (default: 30)
  BACKUP_SYNC_LOG_FILE       log file path                 (optional)

Cron example (daily at 03:30):
  30 3 * * * cd /path/to/backend && python3 scripts/backup-sync.py >> /var/log/backup-sync.log 2>&1
"""

from __future__ import annotations

import argparse
import datetime
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent

# ---------------------------------------------------------------------------
# .env loader (minimal, no dependencies)
# ---------------------------------------------------------------------------

def load_dotenv(env_path: Path) -> None:
    """Read key=value pairs from a .env file into os.environ (does not override)."""
    if not env_path.is_file():
        return
    with env_path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'\"")
            os.environ.setdefault(key, value)


load_dotenv(BACKEND_DIR / ".env")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def get_config(args: argparse.Namespace) -> dict:
    method = args.method or env("BACKUP_SYNC_METHOD", "copy")
    source = args.source or env("BACKUP_SYNC_SOURCE", str(BACKEND_DIR / "data" / "backups"))
    dest = args.dest or env("BACKUP_SYNC_DEST", "")
    max_age = int(args.max_age or env("BACKUP_SYNC_MAX_AGE_DAYS", "30"))
    log_file = args.log_file or env("BACKUP_SYNC_LOG_FILE", "")

    # Method-specific destination fallbacks
    if not dest:
        if method == "rsync":
            dest = env("BACKUP_SYNC_RSYNC_HOST", "")
        elif method == "rclone":
            dest = env("BACKUP_SYNC_RCLONE_REMOTE", "")

    return {
        "method": method.lower(),
        "source": source,
        "dest": dest,
        "max_age_days": max_age,
        "dry_run": args.dry_run,
        "rsync_key": env("BACKUP_SYNC_RSYNC_KEY", ""),
        "log_file": log_file,
    }

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(log_file: str) -> logging.Logger:
    logger = logging.getLogger("backup-sync")
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("[%(asctime)s] %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    logger.addHandler(console)

    if log_file:
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    return logger

# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------

def find_backup_files(source_dir: str, max_age_days: int) -> list[Path]:
    """Return backup files newer than max_age_days, sorted oldest-first."""
    src = Path(source_dir)
    if not src.is_dir():
        return []

    cutoff = datetime.datetime.now() - datetime.timedelta(days=max_age_days)
    files: list[Path] = []

    for f in src.iterdir():
        if not f.is_file():
            continue
        if f.suffix not in (".db", ".json"):
            continue
        mtime = datetime.datetime.fromtimestamp(f.stat().st_mtime)
        if mtime >= cutoff:
            files.append(f)

    files.sort(key=lambda p: p.stat().st_mtime)
    return files

# ---------------------------------------------------------------------------
# Sync methods
# ---------------------------------------------------------------------------

def sync_copy(files: list[Path], dest: str, dry_run: bool, log: logging.Logger) -> int:
    """Plain filesystem copy to a local/mounted path."""
    dest_dir = Path(dest)
    if not dry_run:
        dest_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for f in files:
        target = dest_dir / f.name
        if target.exists() and target.stat().st_size == f.stat().st_size:
            log.info("  skip (exists): %s", f.name)
            continue
        if dry_run:
            log.info("  [dry-run] would copy: %s -> %s", f, target)
        else:
            shutil.copy2(f, target)
            log.info("  copied: %s -> %s", f.name, target)
        copied += 1
    return copied


def sync_rsync(source: str, dest: str, ssh_key: str, dry_run: bool, log: logging.Logger) -> int:
    """Rsync the entire backup directory to a remote host."""
    cmd = ["rsync", "-avz", "--partial", "--progress"]
    if dry_run:
        cmd.append("--dry-run")
    if ssh_key:
        cmd.extend(["-e", f"ssh -i {ssh_key} -o StrictHostKeyChecking=accept-new"])

    # Ensure source has trailing slash so contents are synced, not the directory itself
    src = source.rstrip("/\\") + "/"
    cmd.extend([src, dest])

    log.info("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.stdout:
        for line in result.stdout.strip().splitlines():
            log.info("  rsync: %s", line)
    if result.returncode != 0:
        log.error("rsync failed (exit %d): %s", result.returncode, result.stderr.strip())
        return -1

    return 0


def sync_rclone(source: str, dest: str, dry_run: bool, log: logging.Logger) -> int:
    """Use rclone to sync backups to a cloud remote (Google Drive, S3, etc.)."""
    cmd = ["rclone", "sync", source, dest, "--progress", "--transfers", "4"]
    if dry_run:
        cmd.append("--dry-run")

    log.info("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.stdout:
        for line in result.stdout.strip().splitlines():
            log.info("  rclone: %s", line)
    if result.returncode != 0:
        log.error("rclone failed (exit %d): %s", result.returncode, result.stderr.strip())
        return -1

    return 0

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Sync ImgHoster backups to a remote destination")
    parser.add_argument("--method", choices=["rsync", "rclone", "copy"], help="Sync method")
    parser.add_argument("--source", help="Local backup directory")
    parser.add_argument("--dest", help="Destination path or remote spec")
    parser.add_argument("--max-age", type=int, help="Only sync files newer than N days")
    parser.add_argument("--dry-run", action="store_true", help="Preview without making changes")
    parser.add_argument("--log-file", help="Write log to file")
    args = parser.parse_args()

    cfg = get_config(args)
    log = setup_logging(cfg["log_file"])

    log.info("=" * 60)
    log.info("Backup sync started — method=%s, dry_run=%s", cfg["method"], cfg["dry_run"])
    log.info("  source: %s", cfg["source"])
    log.info("  dest:   %s", cfg["dest"] or "(not set)")

    if not cfg["dest"]:
        log.error("No destination configured. Set BACKUP_SYNC_DEST or use --dest.")
        return 1

    src_path = Path(cfg["source"])
    if not src_path.is_dir():
        log.error("Source directory does not exist: %s", cfg["source"])
        return 1

    files = find_backup_files(cfg["source"], cfg["max_age_days"])
    log.info("  found %d backup file(s) within %d-day window", len(files), cfg["max_age_days"])

    if not files:
        log.info("Nothing to sync.")
        return 0

    method = cfg["method"]

    if method == "copy":
        copied = sync_copy(files, cfg["dest"], cfg["dry_run"], log)
        log.info("Copy complete: %d file(s) transferred", copied)

    elif method == "rsync":
        rc = sync_rsync(cfg["source"], cfg["dest"], cfg["rsync_key"], cfg["dry_run"], log)
        if rc != 0:
            return 1
        log.info("Rsync complete")

    elif method == "rclone":
        rc = sync_rclone(cfg["source"], cfg["dest"], cfg["dry_run"], log)
        if rc != 0:
            return 1
        log.info("Rclone sync complete")

    else:
        log.error("Unknown method: %s", method)
        return 1

    log.info("Backup sync finished successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
