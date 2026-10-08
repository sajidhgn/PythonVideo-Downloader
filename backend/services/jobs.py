"""Tracks media in memory: downloads, edits and Animate pipeline steps running
in background threads, plus uploaded files. Every item has an id that works
with /api/file."""

import threading
import uuid
from pathlib import Path

from config import EDIT_DIR
from services import base, editing, get_service

_jobs = {}


def _new_job() -> tuple[str, dict]:
    job_id = uuid.uuid4().hex[:12]
    job = {"status": "downloading", "progress": 0, "speed": "", "eta": ""}
    _jobs[job_id] = job
    return job_id, job


def _finish(job: dict, path: Path, filename: str):
    job["file"] = str(path)
    job["filename"] = filename
    job["progress"] = 100
    job["status"] = "done"


def _fail(job: dict, e: Exception):
    job["status"] = "error"
    job["error"] = str(e) if isinstance(e, base.ServiceError) else f"Unexpected error: {e}"


def add_ready_file(job_id: str, path: Path, filename: str):
    """Register a file that already exists, such as an upload."""
    _jobs[job_id] = {"status": "done", "progress": 100, "speed": "", "eta": "",
                     "file": str(path), "filename": filename}


def new_media_id() -> str:
    return uuid.uuid4().hex[:12]


def add_output(path: Path, filename: str, media_id: str | None = None) -> str:
    """Register a file a task created, such as one clip of a split. Returns its media id."""
    media_id = media_id or new_media_id()
    add_ready_file(media_id, path, filename)
    return media_id


def start_task(work, *args) -> str:
    """Run work(job, *args) in the background for steps that create several files.
    work reports progress and stage on the job and stores its results there."""
    job_id, job = _new_job()
    job["status"] = "processing"
    threading.Thread(target=_run_task, args=(job, work, args), daemon=True).start()
    return job_id


def _run_task(job: dict, work, args):
    try:
        work(job, *args)
        job["progress"] = 100
        job["status"] = "done"
    except Exception as e:
        _fail(job, e)


def start_download(url: str, quality: str) -> str:
    base.validate_quality(quality)
    service = get_service(url)
    job_id, job = _new_job()
    threading.Thread(target=_run_download, args=(job_id, job, service, url, quality), daemon=True).start()
    return job_id


def _run_download(job_id: str, job: dict, service, url: str, quality: str):
    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                job["progress"] = round(d.get("downloaded_bytes", 0) / total * 100, 1)
            job["speed"] = d.get("_speed_str", "").strip()
            job["eta"] = d.get("_eta_str", "").strip()
        elif d["status"] == "finished":
            job["status"] = "processing"

    try:
        path = service.download(url, quality, job_id, progress_hook)
        _finish(job, path, path.name[len(job_id) + 1:])
    except Exception as e:
        _fail(job, e)


def ready_file(media_id: str) -> Path:
    """Path of a finished download, edit or upload."""
    job = _jobs.get(media_id)
    if not job or job.get("status") != "done":
        raise base.ServiceError("That file isn't available. Download or upload it again.")
    return Path(job["file"])


def start_edit(source_id: str, opts: editing.EditOptions, music_id: str | None = None) -> str:
    """Validate everything up front so bad input is a 400, then run ffmpeg in the background."""
    src = ready_file(source_id)
    info = editing.probe(src)
    if music_id:
        opts.music_path = ready_file(music_id)
        if not editing.probe(opts.music_path).has_audio:
            raise base.ServiceError("The background music file has no audio")

    stem = editing.safe_filename(opts.filename, editing.safe_filename(Path(_jobs[source_id]["filename"]).stem, "edited"))
    filename = stem + editing.output_extension(info)
    return start_render(filename, lambda out: editing.build_command(src, out, info, opts))


def start_render(filename: str, build) -> str:
    """Run one ffmpeg command that writes a new file in EDIT_DIR. build(out) returns
    (command, output duration) and raises ServiceError for bad input, so that is a 400."""
    job_id, job = _new_job()
    out = EDIT_DIR / f"{job_id}_{filename}"
    try:
        cmd, out_duration = build(out)
    except Exception:
        del _jobs[job_id]
        raise
    job["status"] = "processing"
    threading.Thread(target=_run_edit, args=(job, cmd, out_duration, out, filename), daemon=True).start()
    return job_id


def _run_edit(job: dict, cmd: list[str], out_duration: float, out: Path, filename: str):
    def on_progress(pct):
        job["progress"] = pct

    try:
        editing.run(cmd, out_duration, on_progress)
        _finish(job, out, filename)
    except Exception as e:
        out.unlink(missing_ok=True)
        _fail(job, e)


def get_job(job_id: str):
    return _jobs.get(job_id)


def filename_of(media_id: str) -> str:
    return _jobs[media_id]["filename"]


def public_view(job: dict) -> dict:
    """Job state for the API, without the server-side file path."""
    return {k: v for k, v in job.items() if k != "file"}
