"""Picks the right platform service for a link."""

from urllib.parse import urlparse

from services import dailymotion, facebook, generic, instagram, youtube
from services.base import ServiceError

PLATFORM_SERVICES = (youtube, facebook, instagram, dailymotion)


def get_service(url: str):
    """Return the service module for this URL, or the generic one."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ServiceError("Please enter a valid http(s) link")
    host = parsed.hostname.lower()
    for service in PLATFORM_SERVICES:
        if any(host == d or host.endswith("." + d) for d in service.DOMAINS):
            return service
    return generic
