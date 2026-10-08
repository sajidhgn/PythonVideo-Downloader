"""Animate step 3: restyle clips as 3D cartoon, anime or illustration.

Runway does the AI work. The offline preview is a plain ffmpeg cartoon filter,
not AI: it lets you run the whole pipeline without spending credits."""

import math
from pathlib import Path

from services import runway
from services.base import ServiceError
from services.editing import MediaInfo, require_ffmpeg
from services.ffmpeg import FFMPEG_PATH

KEEP = (
    "Keep the same characters, faces, outfits, poses, actions, camera movement, framing and timing "
    "as the input video. Every shot must look like part of one consistent animated film."
)

STYLES = {
    "3d_cartoon": {
        "label": "3D cartoon",
        "prompt": "Restyle this video as a modern 3D animated feature film: stylized characters with "
                  "expressive faces, soft global illumination, smooth rounded shapes and clean materials.",
    },
    "anime": {
        "label": "Anime",
        "prompt": "Restyle this video as hand-drawn 2D anime: clean line art, cel shading, vivid colors "
                  "and painted backgrounds.",
    },
    "illustration": {
        "label": "Illustration",
        "prompt": "Restyle this video as a painted storybook illustration: visible brush texture, "
                  "soft watercolor and gouache colors, and gentle outlines.",
    },
}

# Prices are Runway's published API rates; one credit costs $0.01.
PROVIDERS = {
    "runway_aleph2": {
        "label": "Runway Aleph 2",
        "model": "aleph2",
        "note": "Best quality. Keeps the clip's resolution up to 1080p.",
        "credits_per_second": 28,
        "min_credits": 56,
        "min_seconds": 2,
        "max_seconds": 30,
        "supports_seed": True,
    },
    "runway_gemini_omni_flash": {
        "label": "Runway with Gemini Omni Flash",
        "model": "gemini_omni_flash",
        "note": "Cheaper. 720p output, clips up to 10 seconds.",
        "credits_per_second": 11,
        "min_credits": 0,
        "min_seconds": 1,
        "max_seconds": 10,
        "supports_seed": False,
    },
    "preview": {
        "label": "Offline preview (not AI)",
        "model": None,
        "note": "A free ffmpeg cartoon filter for testing the pipeline. Not for publishing.",
        "credits_per_second": 0,
        "min_credits": 0,
        "min_seconds": 0,
        "max_seconds": None,
        "supports_seed": False,
    },
}

PREVIEW_FILTER = (
    "[0:v]split=2[base][lines];"
    # Flatten detail and colors into a few bands, like cel paint.
    "[base]hqdn3d=4:3:6:4,eq=saturation=1.35:contrast=1.05,"
    "lutrgb=r='trunc(val/32)*32+16':g='trunc(val/32)*32+16':b='trunc(val/32)*32+16',format=gbrp[flat];"
    # Dark ink outlines from the edges.
    "[lines]edgedetect=low=0.08:high=0.2,negate,format=gbrp[ink];"
    "[flat][ink]blend=all_mode=multiply,format=yuv420p[v]"
)


def provider_list() -> list[dict]:
    return [
        {"id": pid, **{k: v for k, v in p.items() if k != "model"},
         "available": p["model"] is None or runway.configured()}
        for pid, p in PROVIDERS.items()
    ]


def get_provider(provider_id: str) -> dict:
    provider = PROVIDERS.get(provider_id)
    if not provider:
        raise ServiceError("Unknown styling provider")
    if provider["model"] and not runway.configured():
        raise ServiceError("Set RUNWAYML_API_SECRET on the backend to use Runway, or pick the offline preview")
    return provider


def build_prompt(style_id: str, extra: str) -> str:
    style = STYLES.get(style_id)
    if not style:
        raise ServiceError("Unknown style")
    prompt = f"{style['prompt']} {extra.strip()} {KEEP}".replace("  ", " ")
    # Runway's limit for Aleph 2 prompts.
    if len(prompt) > 1000:
        raise ServiceError("The extra style notes are too long. Keep them under about 500 characters.")
    return prompt


def estimate_credits(provider: dict, duration: float) -> int:
    return max(provider["min_credits"], math.ceil(provider["credits_per_second"] * duration))


def check_clip(provider: dict, info: MediaInfo, name: str):
    if not info.has_video:
        raise ServiceError(f"{name} has no video")
    if info.duration < provider["min_seconds"] - 0.05:
        raise ServiceError(f"{name} is shorter than the {provider['min_seconds']} s {provider['label']} needs")
    if provider["max_seconds"] and info.duration > provider["max_seconds"] + 0.05:
        raise ServiceError(
            f"{name} is {info.duration:.1f} s, longer than the {provider['max_seconds']} s {provider['label']} "
            "accepts. Split the video again with a shorter maximum clip length."
        )


def preview_command(src: Path, info: MediaInfo, out: Path) -> list[str]:
    require_ffmpeg()
    cmd = [
        FFMPEG_PATH, "-hide_banner", "-y", "-nostats", "-loglevel", "error", "-progress", "pipe:1",
        "-i", str(src), "-filter_complex", PREVIEW_FILTER, "-map", "[v]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    ]
    if info.has_audio:
        cmd += ["-map", "0:a:0", "-c:a", "copy"]
    return cmd + ["-movflags", "+faststart", str(out)]


def runway_clip(provider: dict, src: Path, out: Path, prompt: str, seed: int | None, on_status) -> int | None:
    """Style one clip with Runway. Returns the credits it cost, when Runway reports them."""
    with runway.client() as api:
        on_status("Uploading to Runway", None)
        uri = runway.upload(api, src)
        task_id = runway.start_video_to_video(
            api, provider["model"], uri, prompt, seed if provider["supports_seed"] else None
        )

        def report(status, progress):
            on_status("Waiting in Runway's queue" if status in ("PENDING", "THROTTLED") else "Generating", progress)

        task = runway.wait(api, task_id, report)
    on_status("Downloading the result", None)
    runway.download(task["output"][0], out)
    return (task.get("cost") or {}).get("credits")
