"""Saves uploaded videos (to edit) and audio (background music)."""

import uuid

from config import MAX_UPLOAD_MB, UPLOAD_DIR
from services import editing, jobs
from services.base import ServiceError


def save_upload(filename: str, fileobj) -> str:
    """Store the file, check ffmpeg can read it, and register it as a ready media item."""
    upload_id = uuid.uuid4().hex[:12]
    name = editing.safe_filename(filename, "upload")
    path = UPLOAD_DIR / f"{upload_id}_{name}"

    limit = MAX_UPLOAD_MB * 1024 * 1024
    written = 0
    with open(path, "wb") as out:
        while chunk := fileobj.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                out.close()
                path.unlink(missing_ok=True)
                raise ServiceError(f"File is larger than {MAX_UPLOAD_MB} MB")
            out.write(chunk)

    try:
        editing.probe(path)
    except ServiceError:
        path.unlink(missing_ok=True)
        raise
    jobs.add_ready_file(upload_id, path, name)
    return upload_id
