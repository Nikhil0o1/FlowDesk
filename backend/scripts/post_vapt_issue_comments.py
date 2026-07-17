#!/usr/bin/env python3
"""Post VAPT closure comments to GitHub issues #1-#9.

Requires git credentials for github.com with `repo` scope (same as push access),
or set GITHUB_TOKEN / GH_TOKEN in the environment.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "yanthraa-information-systems/flowdesk_API"
DOCS = Path(__file__).resolve().parents[1] / "docs" / "vapt"


def _git_token() -> str | None:
    try:
        proc = subprocess.run(
            ["git", "credential", "fill"],
            input="protocol=https\nhost=github.com\n\n",
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    for line in proc.stdout.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1]
    return None


def _token() -> str:
    for key in ("GITHUB_TOKEN", "GH_TOKEN"):
        val = os.environ.get(key, "").strip()
        if val:
            return val
    git = _git_token()
    if git:
        return git
    raise SystemExit("No GitHub token: set GITHUB_TOKEN or configure git credentials for github.com")


def post_comment(issue: int, body: str, token: str) -> None:
    url = f"https://api.github.com/repos/{REPO}/issues/{issue}/comments"
    payload = json.dumps({"body": body}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "flowdesk-vapt-closure",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            print(f"  #{issue} posted -> {data.get('html_url')}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"  #{issue} failed ({exc.code}): {detail}") from exc


def main() -> None:
    token = _token()
    issues = range(1, 10)
    print(f"Posting VAPT closure comments to {REPO} ...")
    for num in issues:
        path = DOCS / f"issue-{num:02d}.md"
        if not path.exists():
            raise SystemExit(f"Missing {path}")
        body = path.read_text(encoding="utf-8").strip()
        post_comment(num, body, token)
    print("Done.")


if __name__ == "__main__":
    main()
