"""Animate step 2: find scene changes and cut a video into clips that AI video
models accept (Runway Aleph 2 takes 2-30 s, at most 30 fps and 1080p)."""

import math
import re
import subprocess
import tempfile
from pathlib import Path

from services.base import ServiceError
from services.editing import MediaInfo, require_ffmpeg
from services.ffmpeg import FFMPEG_PATH

MAX_FPS = 30
# Longest side x shortest side.
MAX_SIZE = (1920, 1080)


def detect_cuts(path: Path, threshold: float, duration: float, on_progress) -> list[float]:
    """Times in seconds where the picture changes sharply. threshold is ffmpeg's
    scene score from 0 to 1: lower finds more cuts."""
    require_ffmpeg()
    cmd = [
        FFMPEG_PATH, "-hide_banner", "-nostats", "-progress", "pipe:1", "-i", str(path), "-an", "-sn",
        # Scoring small frames is much faster and finds the same cuts.
        "-vf", f"scale=320:-2,select='gt(scene,{threshold:.3f})',showinfo", "-f", "null", "-",
    ]
    # showinfo logs to stderr, which can fill a pipe while we read progress from stdout.
    with tempfile.TemporaryFile("w+", errors="replace") as log:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log, text=True, errors="replace")
        for line in proc.stdout:
            key, _, value = line.strip().partition("=")
            if key == "out_time_us" and value.isdigit() and duration > 0:
                on_progress(min(99.0, int(value) / 1_000_000 / duration * 100))
        code = proc.wait()
        log.seek(0)
        output = log.read()
    if code != 0:
        raise ServiceError("Couldn't scan this video for scene changes")
    return [float(t) for t in re.findall(r"pts_time:(\d+(?:\.\d+)?)", output)]


def plan_clips(duration: float, cuts: list[float], min_len: float, max_len: float) -> list[tuple[float, float]]:
    """Turn scene cuts into (start, end) clips between min_len and max_len seconds.
    Short scenes join their neighbour; long ones split into equal parts. Needs
    max_len >= 2 * min_len so the parts of a split scene are never too short."""
    if duration < min_len:
        raise ServiceError(f"The video must be at least {min_len:g} seconds long")
    bounds = [0.0, *sorted(t for t in set(cuts) if 0 < t < duration), duration]
    merged: list[list[float]] = []
    for start, end in zip(bounds, bounds[1:]):
        if merged and (end - start < min_len or merged[-1][1] - merged[-1][0] < min_len):
            merged[-1][1] = end
        else:
            merged.append([start, end])

    clips = []
    for start, end in merged:
        parts = max(1, math.ceil((end - start) / max_len - 1e-9))
        step = (end - start) / parts
        clips += [(start + i * step, start + (i + 1) * step) for i in range(parts)]
    return clips


def clip_filters(info: MediaInfo) -> list[str]:
    """Scale down past 1080p and cap the frame rate at 30 fps."""
    filters = []
    if info.width and info.height:
        long_side, short_side = MAX_SIZE
        max_w, max_h = (long_side, short_side) if info.width >= info.height else (short_side, long_side)
        if info.width > max_w or info.height > max_h:
            filters.append(f"scale={max_w}:{max_h}:force_original_aspect_ratio=decrease:force_divisible_by=2")
    if not info.fps or info.fps > MAX_FPS:
        filters.append(f"fps={MAX_FPS}")
    return filters


def cut_command(src: Path, info: MediaInfo, start: float, end: float, out: Path) -> list[str]:
    """Re-encode one clip so it starts exactly on the cut, not on the nearest keyframe."""
    require_ffmpeg()
    cmd = [
        FFMPEG_PATH, "-hide_banner", "-y", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
        "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{end - start:.3f}", "-map", "0:v:0",
    ]
    if info.has_audio:
        cmd += ["-map", "0:a:0"]
    if filters := clip_filters(info):
        cmd += ["-vf", ",".join(filters)]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"]
    if info.has_audio:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    return cmd + ["-movflags", "+faststart", str(out)]
