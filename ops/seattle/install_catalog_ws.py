#!/usr/bin/env python3
"""Install the Seattle catalog-only Nginx WebSocket route on the Seattle host.

Run as root on Seattle after reviewing /etc/nginx/conf.d/act.conf. This script
backs up the file, validates the new Nginx config, and restores it on failure.
"""

from datetime import datetime, timezone
from pathlib import Path
import shutil
import subprocess
import sys


CONFIG = Path("/etc/nginx/conf.d/act.conf")
ANCHOR = "    # 禁止直接访问 OpenClaw Dashboard"
ROUTE = """    # Seattle Worker catalog RPC: WebSocket Upgrade only, with Gateway auth.
    location = /gateway-ws/catalog {
        if ($http_upgrade !~* ^websocket$) {
            return 404;
        }
        proxy_pass http://127.0.0.1:18789/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_buffering off;
    }

"""


def main():
    original = CONFIG.read_text(encoding="utf-8")
    if "location = /gateway-ws/catalog" in original:
        print("catalog WebSocket route already exists; no changes made")
        return 0
    if original.count(ANCHOR) != 1:
        print("expected one OpenClaw Dashboard anchor; no changes made", file=sys.stderr)
        return 1

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = CONFIG.with_name(f"act.conf.before-catalog-ws-{timestamp}")
    shutil.copy2(CONFIG, backup)
    CONFIG.write_text(original.replace(ANCHOR, ROUTE + ANCHOR, 1), encoding="utf-8")
    try:
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except subprocess.CalledProcessError:
        shutil.copy2(backup, CONFIG)
        print(f"Nginx change rolled back; backup: {backup}", file=sys.stderr)
        return 1
    print(f"catalog WebSocket route installed; backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
