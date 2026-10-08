"""Dailymotion service: videos and dai.ly short links."""

from services import base

NAME = "Dailymotion"
DOMAINS = ("dailymotion.com", "dai.ly")
# Dailymotion streams are HLS, served as many small fragments; fetching
# several at once is much faster.
OPTIONS = {"concurrent_fragment_downloads": 4}


def get_info(url: str) -> dict:
    return base.get_info(url, platform=NAME, extra_opts=OPTIONS)


def download(url: str, quality: str, job_id: str, progress_hook):
    return base.download(url, quality, job_id, progress_hook, extra_opts=OPTIONS)
