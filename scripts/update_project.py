"""
update_project.py

Appends a session log entry to project.md.
Includes: UTC timestamp, latest git commit hash/message, and a status update.

This script is narrowly scoped: it only updates project.md.
For broader doc updates (README, schemas, etc.), use the Cursor command:
    .cursor/commands/update_docs.md

Usage:
    python scripts/update_project.py
    python scripts/update_project.py "Fixed the parsing bug and added CSV export"
"""

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def get_git_info() -> tuple[str, str]:
    """Return (short_hash, commit_message) for the latest git commit."""
    try:
        short_hash = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        commit_msg = subprocess.check_output(
            ["git", "log", "-1", "--pretty=%s"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return short_hash, commit_msg
    except subprocess.CalledProcessError:
        return "no-commit", "No git history yet"


def get_status_update() -> str:
    """Read status update from CLI args or prompt stdin."""
    if len(sys.argv) > 1:
        return " ".join(sys.argv[1:])
    try:
        return input("Status update (what did you work on this session?): ").strip()
    except (EOFError, KeyboardInterrupt):
        return "(no status provided)"


def main() -> None:
    project_md = Path(__file__).parent.parent / "project.md"

    if not project_md.exists():
        print(f"Error: {project_md} not found. Are you running from the project root?")
        sys.exit(1)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    short_hash, commit_msg = get_git_info()
    status = get_status_update()

    entry = (
        f"\n## {timestamp}\n"
        f"**Commit:** `{short_hash}` — {commit_msg}\n\n"
        f"{status}\n"
    )

    with open(project_md, "a", encoding="utf-8") as f:
        f.write(entry)

    print(f"Logged to project.md: [{timestamp}] {short_hash} — {status[:60]}")


if __name__ == "__main__":
    main()
