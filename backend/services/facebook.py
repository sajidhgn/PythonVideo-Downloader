"""Facebook service: videos, reels and fb.watch links."""

from services import base

NAME = "Facebook"
DOMAINS = ("facebook.com", "fb.watch", "fb.com")
LOGIN_HINT = (
    "Private, friends-only and group videos need a login. "
    "Start the backend with COOKIES_FROM_BROWSER=chrome to use your browser login."
)


def get_info(url: str) -> dict:
    return base.get_info(url, platform=NAME, login_hint=LOGIN_HINT)


def download(url: str, quality: str, job_id: str, progress_hook):
    return base.download(url, quality, job_id, progress_hook, login_hint=LOGIN_HINT)
