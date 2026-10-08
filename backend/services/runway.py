"""Minimal client for the Runway API (https://docs.dev.runwayml.com): upload a
clip, start a video-to-video task, wait for it and download the result."""

import time
from pathlib import Path

import httpx

from config import RUNWAYML_API_SECRET
from services.base import ServiceError

API_URL = "https://api.dev.runwayml.com"
API_VERSION = "2024-11-06"
# Runway asks clients not to poll a task more often than every 5 seconds.
POLL_SECONDS = 6
TASK_TIMEOUT_SECONDS = 30 * 60


def configured() -> bool:
    return bool(RUNWAYML_API_SECRET)


def client() -> httpx.Client:
    if not RUNWAYML_API_SECRET:
        raise ServiceError("Set RUNWAYML_API_SECRET on the backend to use Runway")
    return httpx.Client(
        base_url=API_URL,
        timeout=httpx.Timeout(60, connect=15),
        headers={"Authorization": f"Bearer {RUNWAYML_API_SECRET}", "X-Runway-Version": API_VERSION},
    )


def _json(res: httpx.Response) -> dict:
    if res.is_success:
        return res.json()
    try:
        detail = res.json().get("error") or res.text
    except ValueError:
        detail = res.text
    if res.status_code == 401:
        raise ServiceError("Runway rejected the API key. Check RUNWAYML_API_SECRET.")
    if res.status_code == 429:
        raise ServiceError("Runway's rate limit was reached. Wait a minute and try again.")
    raise ServiceError(f"Runway error {res.status_code}: {str(detail)[:300]}")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except httpx.HTTPError as e:
        raise ServiceError(f"Couldn't reach Runway: {e}") from e


def upload(api: httpx.Client, path: Path) -> str:
    """Upload a file as an ephemeral asset (kept 24 hours) and return its runway:// URI."""
    slot = _json(_call(api.post, "/v1/uploads", json={"filename": "clip" + path.suffix.lower(), "type": "ephemeral"}))
    with open(path, "rb") as f:
        # A presigned storage URL: it must not get the API key header.
        res = _call(
            httpx.post, slot["uploadUrl"], data=slot["fields"],
            files={"file": ("clip" + path.suffix.lower(), f, "video/mp4")}, timeout=300,
        )
    if not res.is_success:
        raise ServiceError(f"Uploading the clip to Runway failed ({res.status_code})")
    return slot["runwayUri"]


def start_video_to_video(api: httpx.Client, model: str, video_uri: str, prompt: str, seed: int | None) -> str:
    body = {"model": model, "videoUri": video_uri, "promptText": prompt}
    if seed is not None:
        body["seed"] = seed
    return _json(_call(api.post, "/v1/video_to_video", json=body))["id"]


def wait(api: httpx.Client, task_id: str, on_status) -> dict:
    """Poll until the task ends. Calls on_status(status, progress 0-1 or None)."""
    deadline = time.monotonic() + TASK_TIMEOUT_SECONDS
    while True:
        task = _json(_call(api.get, f"/v1/tasks/{task_id}"))
        status = task["status"]
        if status == "SUCCEEDED":
            return task
        if status == "FAILED":
            reason = task.get("failure") or task.get("failureCode") or "no reason given"
            raise ServiceError(f"Runway couldn't style this clip: {reason}")
        if status == "CANCELLED":
            raise ServiceError("The Runway task was cancelled")
        on_status(status, task.get("progress"))
        if time.monotonic() > deadline:
            raise ServiceError("Runway took more than 30 minutes, so the clip was skipped")
        time.sleep(POLL_SECONDS)


def download(url: str, out: Path):
    try:
        with httpx.stream("GET", url, timeout=httpx.Timeout(120, connect=15), follow_redirects=True) as res:
            if not res.is_success:
                raise ServiceError(f"Downloading the styled clip failed ({res.status_code})")
            with open(out, "wb") as f:
                for chunk in res.iter_bytes(1024 * 1024):
                    f.write(chunk)
    except httpx.HTTPError as e:
        out.unlink(missing_ok=True)
        raise ServiceError(f"Downloading the styled clip failed: {e}") from e
