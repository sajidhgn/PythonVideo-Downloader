"""Animate step 5: build the final soundtrack from the video's own sound, a
narration track and background music. Music ducks under speech, and the mix is
normalized to YouTube's loudness. The video stream is copied untouched."""

from dataclasses import dataclass
from pathlib import Path

from services.base import ServiceError
from services.editing import MediaInfo, require_ffmpeg
from services.ffmpeg import FFMPEG_PATH

AUDIO_FORMAT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
# YouTube plays everything at about -14 LUFS, so mixing to that avoids it turning the video down.
LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11"
MUSIC_FADE_OUT = 2.0


@dataclass
class SoundtrackOptions:
    original_volume: float = 1.0
    narration_path: Path | None = None
    narration_volume: float = 1.0
    narration_start: float = 0.0
    music_path: Path | None = None
    music_volume: float = 0.25
    duck_music: bool = True
    normalize: bool = True


def build_command(src: Path, info: MediaInfo, opts: SoundtrackOptions, out: Path) -> tuple[list[str], float]:
    """Return the ffmpeg command and the output duration in seconds."""
    require_ffmpeg()
    if not info.has_video:
        raise ServiceError("Choose the combined video, not an audio file")
    if opts.narration_start >= info.duration:
        raise ServiceError("The narration starts after the video ends")

    duration = info.duration
    cmd = [FFMPEG_PATH, "-hide_banner", "-y", "-nostats", "-loglevel", "error", "-progress", "pipe:1", "-i", str(src)]
    filters = []
    speech = []
    if info.has_audio and opts.original_volume > 0:
        filters.append(f"[0:a:0]{AUDIO_FORMAT},volume={opts.original_volume:.3f}[orig]")
        speech.append("[orig]")
    next_input = 1
    if opts.narration_path:
        cmd += ["-i", str(opts.narration_path)]
        delay = round(opts.narration_start * 1000)
        filters.append(f"[{next_input}:a:0]{AUDIO_FORMAT},adelay=delays={delay}:all=1,volume={opts.narration_volume:.3f}[narr]")
        speech.append("[narr]")
        next_input += 1
    music = None
    if opts.music_path:
        cmd += ["-stream_loop", "-1", "-i", str(opts.music_path)]
        fade_start = max(0.0, duration - MUSIC_FADE_OUT)
        filters.append(
            f"[{next_input}:a:0]{AUDIO_FORMAT},volume={opts.music_volume:.3f},atrim=duration={duration:.3f},"
            f"afade=t=out:st={fade_start:.3f}:d={MUSIC_FADE_OUT}[music]"
        )
        music = "[music]"

    if len(speech) == 2:
        filters.append("[orig][narr]amix=inputs=2:duration=longest:normalize=0[speech]")
        speech = ["[speech]"]

    if music and speech and opts.duck_music:
        # The speech drives a compressor on the music, so the music drops while someone talks.
        filters += [
            # Pad the speech to the full length: the compressor stops when its key input ends.
            f"{speech[0]}apad=whole_dur={duration:.3f},asplit=2[talk][key]",
            "[music][key]sidechaincompress=threshold=0.015:ratio=20:attack=20:release=600[ducked]",
            "[talk][ducked]amix=inputs=2:duration=longest:normalize=0[mix]",
        ]
        mix = "[mix]"
    elif music and speech:
        filters.append(f"{speech[0]}[music]amix=inputs=2:duration=longest:normalize=0[mix]")
        mix = "[mix]"
    else:
        mix = music or (speech[0] if speech else None)

    cmd += ["-map", "0:v:0", "-c:v", "copy"]
    if mix:
        if opts.normalize:
            # loudnorm works at 192 kHz internally, so resample back afterwards.
            filters.append(f"{mix}{LOUDNESS},aresample=48000[aout]")
            mix = "[aout]"
        cmd += ["-filter_complex", ";".join(filters), "-map", mix, "-c:a", "aac", "-b:a", "192k"]
    return cmd + ["-t", f"{duration:.3f}", "-movflags", "+faststart", str(out)], duration
