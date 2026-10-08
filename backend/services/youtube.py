"""YouTube service: videos, Shorts and youtu.be links."""

from services import base

NAME = "YouTube"
DOMAINS = ("youtube.com", "youtu.be")


def get_info(url: str) -> dict:
    return base.get_info(url, platform=NAME)


def download(url: str, quality: str, job_id: str, progress_hook):
    return base.download(url, quality, job_id, progress_hook)
