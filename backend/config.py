"""Settings read from the environment."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
DOWNLOAD_DIR = BASE_DIR / "downloads"
UPLOAD_DIR = BASE_DIR / "uploads"
EDIT_DIR = BASE_DIR / "edited"
for _dir in (DOWNLOAD_DIR, UPLOAD_DIR, EDIT_DIR):
    _dir.mkdir(exist_ok=True)

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "2048"))

# Comma-separated list of allowed frontend URLs. When unset, any localhost port
# is allowed so the Next.js dev server works wherever it starts.
FRONTEND_ORIGINS = os.getenv("FRONTEND_ORIGINS")

# Instagram (and some Facebook videos) only work when logged in. Set this to a
# browser name such as "chrome", "firefox" or "safari" to reuse its cookies.
COOKIES_FROM_BROWSER = os.getenv("COOKIES_FROM_BROWSER")

# Optional proxy for networks that block a platform's video servers, such as
# "http://127.0.0.1:8080" or "socks5://127.0.0.1:1080".
PROXY = os.getenv("PROXY")
