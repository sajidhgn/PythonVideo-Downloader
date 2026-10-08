"""Settings read from the environment."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
DOWNLOAD_DIR = BASE_DIR / "downloads"
UPLOAD_DIR = BASE_DIR / "uploads"
EDIT_DIR = BASE_DIR / "edited"
# Scene clips from the Animate pipeline, before and after AI styling.
CLIP_DIR = BASE_DIR / "clips"
for _dir in (DOWNLOAD_DIR, UPLOAD_DIR, EDIT_DIR, CLIP_DIR):
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

# Runway API key for AI video styling (https://dev.runwayml.com). Without it,
# only the offline preview look is available.
RUNWAYML_API_SECRET = os.getenv("RUNWAYML_API_SECRET")

# OAuth client for publishing to YouTube. Create a "Desktop app" OAuth client in
# Google Cloud with the YouTube Data API v3 enabled. The token is saved to
# YOUTUBE_TOKEN_FILE, which must never be committed.
YOUTUBE_CLIENT_ID = os.getenv("YOUTUBE_CLIENT_ID")
YOUTUBE_CLIENT_SECRET = os.getenv("YOUTUBE_CLIENT_SECRET")
YOUTUBE_TOKEN_FILE = Path(os.getenv("YOUTUBE_TOKEN_FILE", BASE_DIR / "youtube_token.json"))
