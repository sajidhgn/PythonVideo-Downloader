"""The Animate pipeline: owned or licensed footage -> scene clips -> AI styling
-> combined film -> licensed soundtrack -> YouTube. Each step checks its input
up front (so mistakes are a 400) and then runs as a background job."""

from pathlib import Path

from config import CLIP_DIR
from services import combine, editing, jobs, scenes, soundtrack, stylize, youtube_publish
from services.base import ServiceError

RIGHTS_MESSAGE = "Confirm that you own this footage or have a license that lets you transform it"


def _stem(media_id: str, fallback: str) -> str:
    return editing.safe_filename(Path(jobs.filename_of(media_id)).stem, fallback)


# Step 2: split into clips

def start_split(source_id: str, use_scenes: bool, threshold: float, min_len: float, max_len: float,
                rights_confirmed: bool) -> str:
    if not rights_confirmed:
        raise ServiceError(RIGHTS_MESSAGE)
    if max_len < 2 * min_len:
        raise ServiceError("The longest clip must be at least twice the shortest clip")
    src = jobs.ready_file(source_id)
    info = editing.probe(src)
    if not info.has_video:
        raise ServiceError("Choose a video, not an audio file")
    if info.duration < min_len:
        raise ServiceError(f"The video must be at least {min_len:g} seconds long")
    stem = _stem(source_id, "video")
    return jobs.start_task(_split, src, info, stem, use_scenes, threshold, min_len, max_len)


def _split(job: dict, src: Path, info: editing.MediaInfo, stem: str, use_scenes: bool,
           threshold: float, min_len: float, max_len: float):
    scan_share = 30 if use_scenes else 0
    cuts = []
    if use_scenes:
        job["stage"] = "Finding scene changes"
        cuts = scenes.detect_cuts(src, threshold, info.duration, lambda pct: job.update(progress=round(pct * scan_share / 100, 1)))
    segments = scenes.plan_clips(info.duration, cuts, min_len, max_len)

    job["clips"] = []
    done = 0.0
    for i, (start, end) in enumerate(segments, 1):
        job["stage"] = f"Cutting clip {i} of {len(segments)}"
        media_id = jobs.new_media_id()
        filename = f"{stem} - clip {i:02d}.mp4"
        out = CLIP_DIR / f"{media_id}_{filename}"

        def on_progress(pct, length=end - start, before=done):
            job["progress"] = round(scan_share + (before + length * pct / 100) / info.duration * (100 - scan_share), 1)

        try:
            editing.run(scenes.cut_command(src, info, start, end, out), end - start, on_progress)
        except Exception:
            out.unlink(missing_ok=True)
            raise
        jobs.add_output(out, filename, media_id)
        job["clips"].append({
            "id": media_id, "filename": filename,
            "start": round(start, 3), "end": round(end, 3), "duration": round(end - start, 3),
        })
        done += end - start
    job["stage"] = f"{len(segments)} clips ready"


# Step 3: AI video transformation

def start_stylize(clip_ids: list[str], provider_id: str, style_id: str, extra_prompt: str, seed: int,
                  rights_confirmed: bool) -> str:
    if not rights_confirmed:
        raise ServiceError(RIGHTS_MESSAGE)
    if not clip_ids:
        raise ServiceError("Choose at least one clip to style")
    provider = stylize.get_provider(provider_id)
    prompt = stylize.build_prompt(style_id, extra_prompt)
    clips = []
    for clip_id in dict.fromkeys(clip_ids):
        path = jobs.ready_file(clip_id)
        info = editing.probe(path)
        stylize.check_clip(provider, info, jobs.filename_of(clip_id))
        clips.append((clip_id, path, info))
    return jobs.start_task(_stylize, clips, provider_id, provider, style_id, prompt, seed)


def _stylize(job: dict, clips: list, provider_id: str, provider: dict, style_id: str, prompt: str, seed: int):
    job["outputs"] = []
    job["credits"] = 0
    label = stylize.STYLES[style_id]["label"]
    for i, (clip_id, path, info) in enumerate(clips):
        prefix = f"Clip {i + 1} of {len(clips)}"
        job["stage"] = prefix
        media_id = jobs.new_media_id()
        filename = f"{Path(jobs.filename_of(clip_id)).stem} - {label}.mp4"
        out = CLIP_DIR / f"{media_id}_{filename}"

        def report(stage, fraction, i=i, prefix=prefix):
            job["stage"] = f"{prefix}: {stage}"
            job["progress"] = round((i + (fraction or 0)) / len(clips) * 100, 1)

        try:
            if provider_id == "preview":
                editing.run(stylize.preview_command(path, info, out), info.duration, lambda pct: report("Applying the preview look", pct / 100))
                credits = 0
            else:
                credits = stylize.runway_clip(provider, path, out, prompt, seed, report)
            editing.probe(out)  # Make sure the result is a readable video before offering it.
        except Exception as e:
            # One failed clip (for example, blocked by content moderation) shouldn't stop the rest.
            out.unlink(missing_ok=True)
            job["outputs"].append({"source_id": clip_id, "error": str(e) if isinstance(e, ServiceError) else f"Unexpected error: {e}"})
            continue
        jobs.add_output(out, filename, media_id)
        job["credits"] += credits or 0
        job["outputs"].append({"source_id": clip_id, "id": media_id, "filename": filename})

    failed = [o for o in job["outputs"] if "error" in o]
    if failed and len(failed) == len(clips):
        raise ServiceError(failed[0]["error"])
    job["stage"] = f"{len(clips) - len(failed)} of {len(clips)} clips styled"


# Step 4: combine animated clips

def start_combine(parts: list[dict], transitions: list[dict], with_audio: bool, filename: str | None) -> str:
    """parts: [{video_id, audio_id}], where audio_id is the clip to take sound from (or None)."""
    if not parts:
        raise ServiceError("Add at least one clip")
    built = []
    first = None
    for part in parts:
        video = jobs.ready_file(part["video_id"])
        info = editing.probe(video)
        if not info.has_video:
            raise ServiceError(f"{jobs.filename_of(part['video_id'])} has no video")
        first = first or info
        audio = None
        if with_audio and part.get("audio_id"):
            audio = jobs.ready_file(part["audio_id"])
            if not editing.probe(audio).has_audio:
                audio = None
        built.append(combine.Part(video=video, duration=info.duration, audio=audio))
    size = combine.output_size(first.width, first.height)
    fps = min(round(first.fps or 30), 30)
    name = editing.safe_filename(filename, _stem(parts[0]["video_id"], "animated") + " - combined") + ".mp4"
    steps = [combine.Transition(t["kind"], t["duration"]) for t in transitions]
    return jobs.start_render(name, lambda out: combine.build_command(built, steps, out, size, fps, with_audio))


# Step 5: original audio and editing

def start_soundtrack(video_id: str, opts: soundtrack.SoundtrackOptions, narration_id: str | None,
                     music_id: str | None, audio_rights_confirmed: bool, filename: str | None) -> str:
    if (narration_id or music_id) and not audio_rights_confirmed:
        raise ServiceError("Confirm that you made the music and narration or have a license to use them")
    src = jobs.ready_file(video_id)
    info = editing.probe(src)
    for media_id, attr in ((narration_id, "narration_path"), (music_id, "music_path")):
        if media_id:
            path = jobs.ready_file(media_id)
            if not editing.probe(path).has_audio:
                raise ServiceError(f"{jobs.filename_of(media_id)} has no audio")
            setattr(opts, attr, path)
    name = editing.safe_filename(filename, _stem(video_id, "animated") + " - final") + ".mp4"
    return jobs.start_render(name, lambda out: soundtrack.build_command(src, info, opts, out))


# Step 6: publish to YouTube

def start_publish(video_id: str, resource: dict) -> str:
    path = jobs.ready_file(video_id)
    if not editing.probe(path).has_video:
        raise ServiceError("Choose a video to publish")
    if not youtube_publish.connected():
        raise ServiceError("Connect a YouTube account first")
    return jobs.start_task(_publish, path, resource)


def _publish(job: dict, path: Path, resource: dict):
    job["stage"] = "Uploading to YouTube"
    video_id = youtube_publish.upload(path, resource, lambda pct: job.update(progress=round(min(pct, 99.0), 1)))
    job["video_id"] = video_id
    job["url"] = f"https://youtu.be/{video_id}"
    job["studio_url"] = f"https://studio.youtube.com/video/{video_id}/edit"
    job["stage"] = "Uploaded"
