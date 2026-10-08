"""Animate step 6: publish to YouTube with the Data API v3.

Sign-in uses Google's OAuth flow for installed apps (PKCE with a loopback
redirect to this backend), so the browser and the backend must run on the same
machine. Only the youtube.upload scope is requested. The refresh token is saved
to YOUTUBE_TOKEN_FILE with owner-only permissions."""

import base64
import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import urlencode

import httpx

from config import YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_TOKEN_FILE
from services.base import ServiceError

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
SCOPE = "https://www.googleapis.com/auth/youtube.upload"
# Resumable upload chunks must be a multiple of 256 KiB.
CHUNK_BYTES = 32 * 256 * 1024
MAX_RETRIES = 5
SIGN_IN_TTL_SECONDS = 600


def _timeout(seconds: float) -> httpx.Timeout:
    """A short connect timeout: Google resolves to many IPv6 addresses first, and on a
    network with broken IPv6 each one is tried in turn before IPv4."""
    return httpx.Timeout(seconds, connect=5)

CATEGORIES = {
    "1": "Film & Animation",
    "2": "Autos & Vehicles",
    "10": "Music",
    "15": "Pets & Animals",
    "17": "Sports",
    "19": "Travel & Events",
    "20": "Gaming",
    "22": "People & Blogs",
    "23": "Comedy",
    "24": "Entertainment",
    "25": "News & Politics",
    "26": "Howto & Style",
    "27": "Education",
    "28": "Science & Technology",
}
PRIVACY = ("private", "unlisted", "public")

# Sign-ins that were started but not finished: state -> (PKCE verifier, redirect URI, start time).
_pending: dict[str, tuple[str, str, float]] = {}


def configured() -> bool:
    return bool(YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET)


def connected() -> bool:
    return YOUTUBE_TOKEN_FILE.exists()


def status() -> dict:
    return {"configured": configured(), "connected": configured() and connected()}


def _require_configured():
    if not configured():
        raise ServiceError("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET on the backend to publish to YouTube")


def sign_in_url(redirect_uri: str) -> str:
    _require_configured()
    now = time.time()
    for state, (_, _, started) in list(_pending.items()):
        if now - started > SIGN_IN_TTL_SECONDS:
            del _pending[state]
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    _pending[state] = (verifier, redirect_uri, now)
    return AUTH_URL + "?" + urlencode({
        "client_id": YOUTUBE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        # Always ask, so Google returns a refresh token even on a second sign-in.
        "prompt": "consent",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })


def finish_sign_in(state: str, code: str):
    _require_configured()
    entry = _pending.pop(state, None)
    if not entry or time.time() - entry[2] > SIGN_IN_TTL_SECONDS:
        raise ServiceError("This sign-in link has expired. Start again from the app.")
    verifier, redirect_uri, _ = entry
    token = _token_request({
        "code": code,
        "code_verifier": verifier,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    })
    if "refresh_token" not in token:
        raise ServiceError("Google didn't return a refresh token. Remove the app's access in your Google account and connect again.")
    _save_token(token["refresh_token"], token)


def disconnect():
    token = _load_token()
    if token:
        try:
            httpx.post(REVOKE_URL, data={"token": token["refresh_token"]}, timeout=_timeout(15))
        except httpx.HTTPError:
            pass  # The local token is removed either way.
    YOUTUBE_TOKEN_FILE.unlink(missing_ok=True)


def _token_request(data: dict) -> dict:
    try:
        res = httpx.post(TOKEN_URL, data={**data, "client_id": YOUTUBE_CLIENT_ID, "client_secret": YOUTUBE_CLIENT_SECRET}, timeout=_timeout(30))
    except httpx.HTTPError as e:
        raise ServiceError(f"Couldn't reach Google: {e}") from e
    body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if res.status_code == 400 and body.get("error") == "invalid_grant" and data["grant_type"] == "refresh_token":
        YOUTUBE_TOKEN_FILE.unlink(missing_ok=True)
        raise ServiceError("YouTube access has expired or was removed. Connect your account again.")
    if not res.is_success:
        raise ServiceError(f"Google sign-in failed: {body.get('error_description') or body.get('error') or res.status_code}")
    return body


def _save_token(refresh_token: str, token: dict):
    data = {
        "refresh_token": refresh_token,
        "access_token": token["access_token"],
        "expires_at": time.time() + int(token.get("expires_in", 3600)) - 60,
    }
    fd = os.open(YOUTUBE_TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)


def _load_token() -> dict | None:
    try:
        return json.loads(YOUTUBE_TOKEN_FILE.read_text())
    except (OSError, ValueError):
        return None


def _access_token() -> str:
    _require_configured()
    token = _load_token()
    if not token:
        raise ServiceError("Connect a YouTube account first")
    if token["expires_at"] > time.time():
        return token["access_token"]
    fresh = _token_request({"refresh_token": token["refresh_token"], "grant_type": "refresh_token"})
    _save_token(token["refresh_token"], fresh)
    return fresh["access_token"]


def build_metadata(title: str, description: str, tags: list[str], category_id: str, privacy: str,
                   made_for_kids: bool, synthetic_media: bool) -> dict:
    """Validate against YouTube's limits and return the video resource to upload."""
    title = title.strip()
    if not 1 <= len(title) <= 100:
        raise ServiceError("The title must be 1 to 100 characters")
    if any(c in title + description for c in "<>"):
        raise ServiceError("YouTube doesn't allow < or > in the title or description")
    if len(description.encode()) > 5000:
        raise ServiceError("The description must be under 5,000 bytes")
    tags = [t.strip() for t in tags if t.strip()]
    # YouTube counts quotes around tags that contain spaces.
    if sum(len(t) + (2 if " " in t else 0) for t in tags) + max(len(tags) - 1, 0) > 500:
        raise ServiceError("The tags must add up to 500 characters or fewer")
    if category_id not in CATEGORIES:
        raise ServiceError("Unknown YouTube category")
    if privacy not in PRIVACY:
        raise ServiceError("Privacy must be private, unlisted or public")
    return {
        "snippet": {"title": title, "description": description, "tags": tags, "categoryId": category_id},
        "status": {
            "privacyStatus": privacy,
            "selfDeclaredMadeForKids": made_for_kids,
            "containsSyntheticMedia": synthetic_media,
        },
    }


def _google_error(res: httpx.Response) -> ServiceError:
    try:
        error = res.json().get("error", {})
    except ValueError:
        error = {}
    reasons = {e.get("reason") for e in error.get("errors", []) if isinstance(e, dict)}
    if reasons & {"quotaExceeded", "uploadLimitExceeded", "rateLimitExceeded"}:
        return ServiceError("YouTube's upload limit for this account or API project has been reached. Try again tomorrow.")
    if "youtubeSignupRequired" in reasons:
        return ServiceError("This Google account doesn't have a YouTube channel yet. Create one, then try again.")
    if res.status_code == 401:
        YOUTUBE_TOKEN_FILE.unlink(missing_ok=True)
        return ServiceError("YouTube access has expired or was removed. Connect your account again.")
    return ServiceError(f"YouTube rejected the upload: {error.get('message') or res.status_code}")


def upload(path: Path, resource: dict, on_progress) -> str:
    """Resumable upload in chunks, so progress is visible and a dropped connection
    resumes where it stopped. Returns the new video's id."""
    size = path.stat().st_size
    try:
        res = httpx.post(
            UPLOAD_URL,
            params={"uploadType": "resumable", "part": "snippet,status"},
            json=resource,
            headers={
                "Authorization": f"Bearer {_access_token()}",
                "X-Upload-Content-Length": str(size),
                "X-Upload-Content-Type": "video/mp4",
            },
            timeout=_timeout(60),
        )
    except httpx.HTTPError as e:
        raise ServiceError(f"Couldn't reach YouTube: {e}") from e
    if not res.is_success or "location" not in res.headers:
        raise _google_error(res)
    session_url = res.headers["location"]

    offset = 0
    retries = 0
    with open(path, "rb") as f, httpx.Client(timeout=_timeout(300)) as http:
        while True:
            f.seek(offset)
            chunk = f.read(CHUNK_BYTES)
            headers = {"Authorization": f"Bearer {_access_token()}"}
            headers["Content-Range"] = f"bytes {offset}-{offset + len(chunk) - 1}/{size}" if chunk else f"bytes */{size}"
            try:
                res = http.put(session_url, content=chunk, headers=headers)
            except httpx.HTTPError:
                res = None
            if res is not None and res.status_code in (200, 201):
                on_progress(100.0)
                return res.json()["id"]
            if res is not None and res.status_code == 308:
                # "Range: bytes=0-N" is how much YouTube has stored so far.
                stored = res.headers.get("range")
                offset = int(stored.rsplit("-", 1)[1]) + 1 if stored else 0
                retries = 0
                on_progress(offset / size * 100)
                continue
            if res is not None and res.status_code not in (500, 502, 503, 504):
                raise _google_error(res)
            retries += 1
            if retries > MAX_RETRIES:
                raise ServiceError("The upload to YouTube kept failing. Check your connection and try again.")
            time.sleep(2 ** retries)
            offset = _stored_bytes(http, session_url, size)


def _stored_bytes(http: httpx.Client, session_url: str, size: int) -> int:
    """Ask YouTube how much of an interrupted upload it already has."""
    try:
        res = http.put(session_url, headers={"Authorization": f"Bearer {_access_token()}", "Content-Range": f"bytes */{size}"})
    except httpx.HTTPError:
        return 0
    if res.status_code in (200, 201):
        return size  # Already complete: the next status check returns the video.
    stored = res.headers.get("range") if res.status_code == 308 else None
    return int(stored.rsplit("-", 1)[1]) + 1 if stored else 0
