"""Shared yt-dlp core used by every platform service."""

from pathlib import Path

import yt_dlp

from config import COOKIES_FROM_BROWSER, DOWNLOAD_DIR, PROXY
from services.ffmpeg import FFMPEG_PATH, HAS_FFMPEG

DEFAULT_LOGIN_HINT = "Start the backend with COOKIES_FROM_BROWSER=chrome to use your browser login."


class ServiceError(Exception):
    """A user-facing error from a platform service."""


def validate_quality(quality: str):
    if quality not in ("best", "audio") and not quality.isdigit():
        raise ServiceError("Invalid quality")


def build_options(extra=None) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        # Playlists and multi-video posts: only take the first video.
        "playlist_items": "1",
        "socket_timeout": 30,
        "retries": 5,
        "fragment_retries": 5,
    }
    if FFMPEG_PATH:
        opts["ffmpeg_location"] = FFMPEG_PATH
    if COOKIES_FROM_BROWSER:
        opts["cookiesfrombrowser"] = (COOKIES_FROM_BROWSER,)
    if PROXY:
        opts["proxy"] = PROXY
    return {**opts, **(extra or {})}


def format_options(quality: str) -> dict:
    if quality == "audio":
        if HAS_FFMPEG:
            # "best" lets us pull audio out of sites that only offer combined
            # video+audio files (Facebook, Dailymotion).
            return {
                "format": "bestaudio/best",
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }],
            }
        return {"format": "bestaudio[ext=m4a]/bestaudio"}

    height = "" if quality == "best" else f"[height<={int(quality)}]"
    if HAS_FFMPEG:
        return {
            "format": f"bv*{height}+ba/b{height}/bv*+ba/b",
            # At equal resolution prefer H.264 + AAC: AV1/VP9 with Opus plays
            # in browsers but not in QuickTime or on many phones and TVs.
            "format_sort": ["res", "vcodec:h264", "acodec:aac"],
            "merge_output_format": "mp4",
        }
    return {"format": f"b{height}[ext=mp4][acodec!=none][vcodec!=none]/b{height}/b"}


def to_service_error(e: Exception, login_hint=None) -> ServiceError:
    msg = str(e).replace("ERROR: ", "", 1)
    lower = msg.lower()
    if any(s in lower for s in (
        "does not contain any stream",
        "output file does not contain",
        "unable to obtain file audio codec",
    )):
        return ServiceError("This video doesn't seem to have an audio track.")
    if "timed out" in lower:
        return ServiceError(
            f"{msg} (Your network may be blocking this site's video servers. "
            "Try again, or start the backend with PROXY=<proxy url>.)"
        )
    if "login" in lower or "cookies" in lower:
        return ServiceError(f"{msg} (Tip: {login_hint or DEFAULT_LOGIN_HINT})")
    return ServiceError(msg)


def get_info(url: str, platform=None, extra_opts=None, login_hint=None) -> dict:
    try:
        with yt_dlp.YoutubeDL(build_options(extra_opts)) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        raise to_service_error(e, login_hint)

    if info.get("entries"):
        entries = [e for e in info["entries"] if e]
        if not entries:
            raise ServiceError("No video found at this link")
        info = entries[0]

    heights = sorted(
        {
            f["height"] for f in info.get("formats") or []
            if f.get("height") and f.get("vcodec") != "none"
        },
        reverse=True,
    )
    return {
        "title": info.get("title") or "Untitled",
        "uploader": info.get("uploader") or info.get("channel"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "platform": platform or info.get("extractor_key") or info.get("extractor"),
        "heights": heights,
        "ffmpeg": HAS_FFMPEG,
    }


def download(url: str, quality: str, job_id: str, progress_hook, extra_opts=None, login_hint=None) -> Path:
    """Download into DOWNLOAD_DIR and return the final file path."""
    opts = {
        **build_options(extra_opts),
        "outtmpl": str(DOWNLOAD_DIR / f"{job_id}_%(title).80B.%(ext)s"),
        "progress_hooks": [progress_hook],
        **format_options(quality),
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:
        raise to_service_error(e, login_hint)

    # Post-processing can change the extension, so look for the final file.
    files = [
        f for f in DOWNLOAD_DIR.glob(f"{job_id}_*")
        if not f.name.endswith((".part", ".ytdl"))
    ]
    if not files:
        raise ServiceError("Download finished but no file was found")
    return max(files, key=lambda p: p.stat().st_mtime)
