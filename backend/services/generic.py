"""Fallback service for every other site yt-dlp supports (TikTok, X, Vimeo,
Reddit, ...). The platform name comes from yt-dlp itself."""

from services import base

NAME = None
DOMAINS = ()


def get_info(url: str) -> dict:
    return base.get_info(url)


def download(url: str, quality: str, job_id: str, progress_hook):
    return base.download(url, quality, job_id, progress_hook)
