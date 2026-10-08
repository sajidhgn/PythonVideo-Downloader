"""Video downloader and editor API. Downloads from YouTube, Facebook,
Instagram, Dailymotion and everything else yt-dlp supports, and edits with
ffmpeg. The Next.js app in ../frontend is the UI.

Routes only: the work happens in the services package."""

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from config import FRONTEND_ORIGINS
from services import ServiceError, editing, get_service, jobs, uploads
from services.ffmpeg import HAS_FFMPEG

app = FastAPI(title="Video Downloader API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS.split(",") if FRONTEND_ORIGINS else [],
    allow_origin_regex=None if FRONTEND_ORIGINS else r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class InfoRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    quality: str = "best"  # "best", a height such as "720", or "audio"


class EditRequest(BaseModel):
    source_id: str
    trim_start: float = Field(0, ge=0)
    trim_end: float | None = Field(None, gt=0)
    speed: float = Field(1.0, ge=0.25, le=4)
    original_volume: float = Field(1.0, ge=0, le=2)
    music_id: str | None = None
    music_volume: float = Field(0.3, ge=0, le=2)
    # Omit a field to keep it, send "" to remove it.
    title: str | None = Field(None, max_length=300)
    alt_text: str | None = Field(None, max_length=2000)
    tags: str | None = Field(None, max_length=500)
    author: str | None = Field(None, max_length=200)
    filename: str | None = Field(None, max_length=150)


@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": HAS_FFMPEG}


@app.post("/api/info")
def video_info(req: InfoRequest):
    try:
        return get_service(req.url).get_info(req.url)
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/download")
def start_download(req: DownloadRequest):
    try:
        return {"job_id": jobs.start_download(req.url, req.quality)}
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/progress/{job_id}")
def progress(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs.public_view(job)


@app.post("/api/uploads")
def upload_file(file: UploadFile = File(...)):
    try:
        media_id = uploads.save_upload(file.filename or "upload", file.file)
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return media_info(media_id)


@app.get("/api/media/{media_id}")
def media_info(media_id: str):
    try:
        path = jobs.ready_file(media_id)
        info = editing.probe(path)
    except ServiceError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "id": media_id,
        "filename": jobs.get_job(media_id)["filename"],
        "duration": round(info.duration, 2),
        "has_video": info.has_video,
        "has_audio": info.has_audio,
        # The details the editor can change, as currently saved in the file.
        "details": {
            "title": info.metadata.get("title", ""),
            "alt_text": info.metadata.get("description") or info.metadata.get("comment", ""),
            "tags": info.metadata.get("keywords", ""),
            "author": info.metadata.get("artist", ""),
        },
    }


@app.post("/api/edit")
def start_edit(req: EditRequest):
    opts = editing.EditOptions(
        trim_start=req.trim_start,
        trim_end=req.trim_end,
        speed=req.speed,
        original_volume=req.original_volume,
        music_volume=req.music_volume,
        title=req.title,
        alt_text=req.alt_text,
        tags=req.tags,
        author=req.author,
        filename=req.filename,
    )
    try:
        return {"job_id": jobs.start_edit(req.source_id, opts, req.music_id)}
    except ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/file/{job_id}")
def get_file(job_id: str, download: bool = True):
    """Serve a finished file. download=false lets the editor preview it inline."""
    job = jobs.get_job(job_id)
    if not job or job.get("status") != "done" or not Path(job["file"]).exists():
        raise HTTPException(status_code=404, detail="File not ready")
    return FileResponse(
        job["file"],
        filename=job["filename"],
        content_disposition_type="attachment" if download else "inline",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
