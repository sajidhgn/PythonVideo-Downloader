"""Instagram service: posts, reels and IGTV. Carousel posts download their
first video."""

from services import base

NAME = "Instagram"
DOMAINS = ("instagram.com",)
LOGIN_HINT = (
    "Instagram often requires a login. "
    "Start the backend with COOKIES_FROM_BROWSER=chrome to use your browser login."
)


def get_info(url: str) -> dict:
    return base.get_info(url, platform=NAME, login_hint=LOGIN_HINT)


def download(url: str, quality: str, job_id: str, progress_hook):
    return base.download(url, quality, job_id, progress_hook, login_hint=LOGIN_HINT)
