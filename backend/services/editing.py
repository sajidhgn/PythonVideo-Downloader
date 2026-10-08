"""Video editing with ffmpeg: trim, speed, volume, background music, and the
file's name, title, alt text (description), tags and author."""

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from services.base import ServiceError
from services.ffmpeg import FFMPEG_PATH


@dataclass
class MediaInfo:
    duration: float
    has_video: bool
    has_audio: bool
    fps: float | None = None
    metadata: dict | None = None
    # Display size, after any rotation a phone recorded.
    width: int | None = None
    height: int | None = None


@dataclass
class EditOptions:
    trim_start: float = 0.0
    trim_end: float | None = None
    speed: float = 1.0
    original_volume: float = 1.0
    music_path: Path | None = None
    music_volume: float = 0.3
    # None leaves a field unchanged, "" removes it.
    title: str | None = None
    alt_text: str | None = None
    tags: str | None = None
    author: str | None = None
    filename: str | None = None


def require_ffmpeg():
    if not FFMPEG_PATH:
        raise ServiceError("ffmpeg is not available on the backend")


def parse_metadata(ffmpeg_output: str) -> dict:
    """Read the file-level tags ffmpeg prints between "Input #0" and "Duration:"."""
    header = ffmpeg_output.split("Input #0", 1)[-1].split("Duration:", 1)[0]
    tags = {}
    key = None
    for line in header.splitlines():
        if m := re.match(r"^\s{4}(\w+)\s*: ?(.*)$", line):
            key = m.group(1).lower()
            tags[key] = m.group(2)
        elif key and (m := re.match(r"^\s+: ?(.*)$", line)):
            tags[key] += "\n" + m.group(1)  # continuation of a multi-line value
    return tags


def probe(path: Path) -> MediaInfo:
    """Read duration and stream types. Uses ffmpeg because the bundled build has no ffprobe."""
    require_ffmpeg()
    result = subprocess.run(
        [FFMPEG_PATH, "-hide_banner", "-i", str(path)],
        capture_output=True, text=True, errors="replace",
    )
    out = result.stderr
    match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", out)
    streams = re.findall(r"Stream #\d+:\d+.*", out)
    # Album art in audio files shows up as a video stream.
    video_streams = [s for s in streams if ": Video:" in s and "(attached pic)" not in s]
    has_audio = any(": Audio:" in s for s in streams)
    if not match or not (video_streams or has_audio):
        raise ServiceError("This file isn't a video or audio file ffmpeg can read")
    fps_match = re.search(r"(\d+(?:\.\d+)?) fps", video_streams[0]) if video_streams else None
    size_match = re.search(r", (\d{2,5})x(\d{2,5})\b", video_streams[0]) if video_streams else None
    width, height = (int(size_match.group(1)), int(size_match.group(2))) if size_match else (None, None)
    if re.search(r"rotation of -?(90|270)\.", out):
        width, height = height, width
    h, m, s = match.groups()
    return MediaInfo(
        duration=int(h) * 3600 + int(m) * 60 + float(s),
        has_video=bool(video_streams),
        has_audio=has_audio,
        fps=float(fps_match.group(1)) if fps_match else None,
        metadata=parse_metadata(out),
        width=width,
        height=height,
    )


def frame_jpeg(path: Path, t: float, width: int = 480) -> bytes:
    """One frame at t seconds as a JPEG, for thumbnails and continuity checks."""
    require_ffmpeg()
    result = subprocess.run(
        [FFMPEG_PATH, "-hide_banner", "-loglevel", "error", "-ss", f"{max(t, 0):.3f}", "-i", str(path),
         "-frames:v", "1", "-vf", f"scale={width}:-2", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"],
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout:
        raise ServiceError("Couldn't read a frame at that time")
    return result.stdout


def safe_filename(name: str | None, fallback: str) -> str:
    """Strip characters that aren't allowed in file names on macOS/Windows."""
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name or "").strip(" .")
    return cleaned[:120] or fallback


def atempo_chain(speed: float) -> list[str]:
    """Split a speed factor into atempo steps within the 0.5-2.0 range every ffmpeg accepts."""
    steps = []
    while speed > 2.0:
        steps.append("atempo=2.0")
        speed /= 2.0
    while speed < 0.5:
        steps.append("atempo=0.5")
        speed /= 0.5
    steps.append(f"atempo={speed:.6f}")
    return steps


def metadata_args(opts: EditOptions) -> list[str]:
    values = {
        "title": opts.title,
        # Video files have no alt attribute; description (and comment, which
        # more players display) is the closest equivalent.
        "description": opts.alt_text,
        "comment": opts.alt_text,
        "keywords": opts.tags,
        "artist": opts.author,
    }
    args = []
    for key, value in values.items():
        if value is not None:
            args += ["-metadata", f"{key}={value.strip()}"]
    return args


def is_copy_only(opts: EditOptions) -> bool:
    """True when only the name or metadata changes, so streams can be copied as-is."""
    return (
        opts.trim_start == 0
        and opts.trim_end is None
        and opts.speed == 1
        and opts.original_volume == 1
        and opts.music_path is None
    )


def output_extension(info: MediaInfo) -> str:
    return ".mp4" if info.has_video else ".mp3"


def build_command(src: Path, out: Path, info: MediaInfo, opts: EditOptions) -> tuple[list[str], float]:
    """Return the ffmpeg command and the output duration in seconds."""
    require_ffmpeg()
    end = info.duration if opts.trim_end is None else opts.trim_end
    if not 0 <= opts.trim_start < end or end > info.duration + 0.5:
        raise ServiceError(f"Trim range must be within 0 and {info.duration:.1f} seconds")
    segment = end - opts.trim_start
    if segment < 0.1:
        raise ServiceError("The trimmed clip is too short")
    out_duration = segment / opts.speed

    cmd = [FFMPEG_PATH, "-hide_banner", "-y", "-nostats", "-loglevel", "error", "-progress", "pipe:1"]

    if is_copy_only(opts) and src.suffix.lower() == out.suffix.lower():
        cmd += ["-i", str(src), "-map", "0", "-c", "copy", "-map_metadata", "0", *metadata_args(opts)]
        if info.has_video:
            cmd += ["-movflags", "+faststart"]
        return cmd + [str(out)], info.duration

    if opts.trim_start > 0 or opts.trim_end is not None:
        cmd += ["-ss", f"{opts.trim_start:.3f}", "-t", f"{segment:.3f}"]
    cmd += ["-i", str(src)]
    if opts.music_path:
        cmd += ["-stream_loop", "-1", "-i", str(opts.music_path)]

    filters = []
    audio_labels = []
    if info.has_audio and opts.original_volume > 0:
        chain = []
        if opts.speed != 1:
            chain += atempo_chain(opts.speed)
        if opts.original_volume != 1:
            chain.append(f"volume={opts.original_volume:.3f}")
        filters.append(f"[0:a]{','.join(chain) or 'anull'}[a0]")
        audio_labels.append("[a0]")
    if opts.music_path:
        filters.append(f"[1:a]volume={opts.music_volume:.3f}[bg]")
        audio_labels.append("[bg]")
    if len(audio_labels) == 2:
        filters.append("[a0][bg]amix=inputs=2:duration=first:normalize=0[aout]")
        audio_map = "[aout]"
    else:
        audio_map = audio_labels[0] if audio_labels else None

    video_map = None
    if info.has_video:
        if opts.speed != 1:
            # Keep the original frame rate: slow motion would otherwise drop
            # to e.g. 12.5 fps and speed-ups would jump to odd rates.
            keep_fps = f",fps={info.fps:g}" if info.fps else ""
            filters.append(f"[0:v]setpts=PTS/{opts.speed:.6f}{keep_fps}[v]")
            video_map = "[v]"
        else:
            video_map = "0:v:0"

    if filters:
        cmd += ["-filter_complex", ";".join(filters)]
    if video_map:
        cmd += ["-map", video_map, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
    if audio_map:
        cmd += ["-map", audio_map]
        cmd += ["-c:a", "aac", "-b:a", "192k"] if info.has_video else ["-c:a", "libmp3lame", "-q:a", "2"]
    elif not video_map:
        raise ServiceError("Nothing left to export: the audio is muted and there's no video")

    cmd += ["-map_metadata", "0", *metadata_args(opts), "-t", f"{out_duration:.3f}"]
    if info.has_video:
        cmd += ["-movflags", "+faststart"]
    return cmd + [str(out)], out_duration


def run(cmd: list[str], out_duration: float, on_progress):
    """Run ffmpeg, reporting progress (0-100) from its -progress output."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    for line in proc.stdout:
        key, _, value = line.strip().partition("=")
        if key == "out_time_us" and value.isdigit() and out_duration > 0:
            on_progress(min(99.0, round(int(value) / 1_000_000 / out_duration * 100, 1)))
    stderr = proc.stderr.read()
    if proc.wait() != 0:
        last = stderr.strip().splitlines()[-1] if stderr.strip() else "unknown error"
        raise ServiceError(f"Editing failed: {last}")
