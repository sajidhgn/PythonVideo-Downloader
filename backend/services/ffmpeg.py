"""Locates ffmpeg, which merges separate video+audio streams and converts audio
to MP3. Without it we fall back to single-file formats."""

import shutil


def find_ffmpeg():
    """Prefer a system ffmpeg, else the static binary bundled with imageio-ffmpeg."""
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG_PATH = find_ffmpeg()
HAS_FFMPEG = FFMPEG_PATH is not None
