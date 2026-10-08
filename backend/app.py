"""Video downloader and editor API. Downloads from YouTube, Facebook,
Instagram, Dailymotion and everything else yt-dlp supports, edits with ffmpeg,
and turns owned or licensed footage into an animated film for YouTube (the
Animate pipeline). The Next.js app in ../frontend is the UI.

Routes only: the work happens in the services package."""

import html
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, Field

from config import FRONTEND_ORIGINS
from services import ServiceError, editing, get_service, jobs, pipeline, runway, soundtrack, stylize, uploads, youtube_publish
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


class SplitRequest(BaseModel):
    source_id: str
    use_scenes: bool = True
    # ffmpeg's scene score: lower finds more cuts.
    threshold: float = Field(0.3, ge=0.05, le=0.9)
    min_seconds: float = Field(2, ge=1, le=10)
    max_seconds: float = Field(10, ge=2, le=30)
    rights_confirmed: bool = False


class StylizeRequest(BaseModel):
    clip_ids: list[str] = Field(min_length=1, max_length=200)
    provider: str
    style: str
    extra_prompt: str = Field("", max_length=500)
    # The same seed for every clip keeps characters and colors consistent.
    seed: int = Field(0, ge=0, le=4294967295)
    rights_confirmed: bool = False


class CombinePart(BaseModel):
    video_id: str
    # The clip to take this part's sound from, usually the clip before styling.
    audio_id: str | None = None


class CombineTransition(BaseModel):
    kind: Literal["cut", "crossfade", "fadeblack"] = "cut"
    duration: float = Field(0.5, ge=0, le=2)


class CombineRequest(BaseModel):
    parts: list[CombinePart] = Field(min_length=1, max_length=200)
    transitions: list[CombineTransition] = []
    with_audio: bool = True
    filename: str | None = Field(None, max_length=150)


class SoundtrackRequest(BaseModel):
    video_id: str
    original_volume: float = Field(1.0, ge=0, le=2)
    narration_id: str | None = None
    narration_volume: float = Field(1.0, ge=0, le=2)
    narration_start: float = Field(0, ge=0)
    music_id: str | None = None
    music_volume: float = Field(0.25, ge=0, le=1)
    duck_music: bool = True
    normalize: bool = True
    audio_rights_confirmed: bool = False
    filename: str | None = Field(None, max_length=150)


class PublishRequest(BaseModel):
    video_id: str
    title: str = Field(max_length=100)
    description: str = Field("", max_length=5000)
    tags: list[str] = Field([], max_length=100)
    category_id: str = "1"
    privacy: Literal["private", "unlisted", "public"] = "private"
    # No defaults: YouTube needs an explicit answer to both.
    made_for_kids: bool
    contains_synthetic_media: bool
    # The publishing checklist. Every item must be confirmed.
    footage_rights: bool = False
    audio_rights: bool = False
    original_value: bool = False
    guidelines: bool = False


def bad_request(e: ServiceError):
    return HTTPException(status_code=400, detail=str(e))


@app.get("/api/health")
def health():
    return {"ok": True, "ffmpeg": HAS_FFMPEG, "runway": runway.configured(), "youtube": youtube_publish.status()}


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


@app.get("/api/media/{media_id}/frame")
def media_frame(media_id: str, t: float = 0, from_end: bool = False):
    """A JPEG of one frame. from_end counts t back from the end, for checking how a clip ends."""
    try:
        path = jobs.ready_file(media_id)
        if not from_end:
            image = editing.frame_jpeg(path, t)
        else:
            # The very last timestamp can fall after the last frame, so step back until one decodes.
            duration = editing.probe(path).duration
            image = None
            for back in (0.1, 0.5, 1.0):
                try:
                    image = editing.frame_jpeg(path, duration - back - t)
                    break
                except ServiceError:
                    continue
            if image is None:
                raise ServiceError("Couldn't read the last frame")
    except ServiceError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # Media items never change, so the browser can keep frames.
    return Response(image, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


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


# Animate pipeline: original video -> clips -> AI styling -> combine -> soundtrack -> YouTube

@app.get("/api/animate/options")
def animate_options():
    return {
        "styles": [{"id": k, "label": v["label"]} for k, v in stylize.STYLES.items()],
        "providers": stylize.provider_list(),
        "youtube": {**youtube_publish.status(), "categories": youtube_publish.CATEGORIES},
    }


@app.post("/api/animate/split")
def animate_split(req: SplitRequest):
    try:
        return {"job_id": pipeline.start_split(
            req.source_id, req.use_scenes, req.threshold, req.min_seconds, req.max_seconds, req.rights_confirmed
        )}
    except ServiceError as e:
        raise bad_request(e)


@app.post("/api/animate/stylize")
def animate_stylize(req: StylizeRequest):
    try:
        return {"job_id": pipeline.start_stylize(
            req.clip_ids, req.provider, req.style, req.extra_prompt, req.seed, req.rights_confirmed
        )}
    except ServiceError as e:
        raise bad_request(e)


@app.post("/api/animate/combine")
def animate_combine(req: CombineRequest):
    try:
        return {"job_id": pipeline.start_combine(
            [p.model_dump() for p in req.parts], [t.model_dump() for t in req.transitions], req.with_audio, req.filename
        )}
    except ServiceError as e:
        raise bad_request(e)


@app.post("/api/animate/soundtrack")
def animate_soundtrack(req: SoundtrackRequest):
    opts = soundtrack.SoundtrackOptions(
        original_volume=req.original_volume,
        narration_volume=req.narration_volume,
        narration_start=req.narration_start,
        music_volume=req.music_volume,
        duck_music=req.duck_music,
        normalize=req.normalize,
    )
    try:
        return {"job_id": pipeline.start_soundtrack(
            req.video_id, opts, req.narration_id, req.music_id, req.audio_rights_confirmed, req.filename
        )}
    except ServiceError as e:
        raise bad_request(e)


def _result_page(title: str, message: str) -> HTMLResponse:
    """A small page for the browser tab that Google's sign-in returns to."""
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{html.escape(title)}</title>"
        "<body style='font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5'>"
        f"<h1 style='font-size:1.25rem'>{html.escape(title)}</h1><p>{html.escape(message)}</p></body>"
    )


@app.get("/api/youtube/status")
def youtube_status():
    return youtube_publish.status()


@app.get("/api/youtube/connect")
def youtube_connect(request: Request):
    """Opened in a browser tab: sends the user to Google's consent screen."""
    try:
        return RedirectResponse(youtube_publish.sign_in_url(str(request.url_for("youtube_callback"))))
    except ServiceError as e:
        return _result_page("YouTube isn't set up", str(e))


@app.get("/api/youtube/callback", name="youtube_callback")
def youtube_callback(state: str = "", code: str = "", error: str = ""):
    if error:
        return _result_page("YouTube wasn't connected", f"Google returned: {error}. You can close this tab.")
    try:
        youtube_publish.finish_sign_in(state, code)
    except ServiceError as e:
        return _result_page("YouTube wasn't connected", str(e))
    return _result_page("YouTube connected", "You can close this tab and go back to the app.")


@app.post("/api/youtube/disconnect")
def youtube_disconnect():
    youtube_publish.disconnect()
    return youtube_publish.status()


@app.post("/api/youtube/publish")
def youtube_publish_video(req: PublishRequest):
    if not (req.footage_rights and req.audio_rights and req.original_value and req.guidelines):
        raise HTTPException(status_code=400, detail="Confirm every item in the publishing checklist first")
    try:
        resource = youtube_publish.build_metadata(
            req.title, req.description, req.tags, req.category_id, req.privacy,
            req.made_for_kids, req.contains_synthetic_media,
        )
        return {"job_id": pipeline.start_publish(req.video_id, resource)}
    except ServiceError as e:
        raise bad_request(e)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
