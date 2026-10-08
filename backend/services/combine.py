"""Animate step 4: join clips in order with a cut, crossfade or fade through
black between each pair. Every clip is scaled and padded to the first clip's
size and given the same frame rate, so mixed sources join cleanly."""

from dataclasses import dataclass
from pathlib import Path

from services.base import ServiceError
from services.editing import require_ffmpeg
from services.ffmpeg import FFMPEG_PATH

TRANSITIONS = {"cut": None, "crossfade": "fade", "fadeblack": "fadeblack"}
AUDIO_FORMAT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"


@dataclass
class Part:
    video: Path
    duration: float
    # The file to take this clip's sound from (usually the clip before styling),
    # or None for silence.
    audio: Path | None = None


@dataclass
class Transition:
    kind: str = "cut"
    duration: float = 0.0


def output_size(width: int | None, height: int | None) -> tuple[int, int]:
    """Even dimensions, which H.264 needs."""
    if not width or not height:
        return 1280, 720
    return width - width % 2, height - height % 2


def build_command(parts: list[Part], transitions: list[Transition], out: Path,
                  size: tuple[int, int], fps: float, with_audio: bool) -> tuple[list[str], float]:
    """Return the ffmpeg command and the output duration in seconds."""
    require_ffmpeg()
    if not parts:
        raise ServiceError("Add at least one clip")
    if len(transitions) != len(parts) - 1:
        raise ServiceError("There must be one transition between each pair of clips")
    for t in transitions:
        if t.kind not in TRANSITIONS:
            raise ServiceError(f"Unknown transition: {t.kind}")

    width, height = size
    cmd = [FFMPEG_PATH, "-hide_banner", "-y", "-nostats", "-loglevel", "error", "-progress", "pipe:1"]
    inputs: list[Path] = []

    def input_index(path: Path) -> int:
        if path not in inputs:
            inputs.append(path)
        return inputs.index(path)

    filters = []
    for i, part in enumerate(parts):
        d = f"{part.duration:.3f}"
        v = input_index(part.video)
        filters.append(
            f"[{v}:v:0]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,"
            # Repeat the last frame if the stream is a little short, so transitions line up.
            f"tpad=stop_mode=clone:stop_duration=1,trim=duration={d},setpts=PTS-STARTPTS,"
            # Last, because setpts marks the frame rate as unknown and xfade needs a constant one.
            f"fps={fps:g}[v{i}]"
        )
        if with_audio:
            if part.audio:
                a = input_index(part.audio)
                filters.append(f"[{a}:a:0]{AUDIO_FORMAT},apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]")
            else:
                filters.append(f"anullsrc=r=48000:cl=stereo,{AUDIO_FORMAT},atrim=duration={d}[a{i}]")

    total = parts[0].duration
    cur = "0"
    for i, t in enumerate(transitions, start=1):
        prev_len, next_len = parts[i - 1].duration, parts[i].duration
        # At most half of either clip, so a clip is never covered by transitions from both sides.
        fade = min(t.duration, prev_len / 2, next_len / 2) if TRANSITIONS[t.kind] else 0
        if fade < 0.05:
            # concat leaves a variable frame rate, which a later xfade rejects.
            filters.append(f"[v{cur}][v{i}]concat=n=2:v=1:a=0,fps={fps:g}[vc{i}]")
            if with_audio:
                filters.append(f"[a{cur}][a{i}]concat=n=2:v=0:a=1[ac{i}]")
            total += next_len
        else:
            filters.append(
                f"[v{cur}][v{i}]xfade=transition={TRANSITIONS[t.kind]}:duration={fade:.3f}:offset={total - fade:.3f}[vc{i}]"
            )
            if with_audio:
                filters.append(f"[a{cur}][a{i}]acrossfade=d={fade:.3f}[ac{i}]")
            total += next_len - fade
        cur = f"c{i}"

    for path in inputs:
        cmd += ["-i", str(path)]
    cmd += ["-filter_complex", ";".join(filters), "-map", f"[v{cur}]"]
    if with_audio:
        cmd += ["-map", f"[a{cur}]", "-c:a", "aac", "-b:a", "192k"]
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-t", f"{total:.3f}", "-movflags", "+faststart", str(out),
    ]
    return cmd, total
