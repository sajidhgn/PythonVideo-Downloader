# Tasks

Task list for the video app: a FastAPI + yt-dlp backend in `backend/` and a Next.js frontend in `frontend/`. The app downloads videos, edits them, dubs them into Arabic in the speaker's own voice, and turns owned or licensed footage into an animated video for YouTube (the Animate tab).

## Rules for Claude

- Work top to bottom. Finish P0 before P1, and so on. Do one task at a time.
- Before you mark a task `[x]`, confirm it works: run the tests, the lint and the build, or the app itself. Then add the date and a one-line note, and move the task to **Done**.
- If you find a new problem while working, add it to the section it belongs in. Don't fix it unless the user asks.
- Follow the **Decisions** section. Don't swap a model or library without asking the user, and record any change there.
- Never modify or delete a user's original video. Edits and dubs always create a new file.
- Check free disk space (`df -h ~`) before installing AI packages or downloading model weights. If less than 15 GB is free, stop and tell the user.
- Never delete anything outside this repo (caches, Ollama models) without the user's OK.
- Read [frontend/AGENTS.md](frontend/AGENTS.md) before you change any frontend code. This project uses Next.js 16.4, which has breaking changes. Its docs are in `frontend/node_modules/next/dist/docs/`.
- Don't commit or push unless the user asks.

## Running the app

```bash
# One-time setup (the requirements-ai.txt file is created in P0)
brew install ffmpeg
uv venv --python 3.11 backend/.venv && source backend/.venv/bin/activate
uv pip install -r backend/requirements.txt       # downloader + editor
uv pip install -r backend/requirements-ai.txt    # dubbing + captions (~10 GB with models)
ollama pull qwen3:8b                             # already on this Mac

# Backend: http://127.0.0.1:8000
cd backend && python app.py

# Frontend: http://localhost:3001
cd frontend && npm install && npm run dev
```

Environment variables:

| Variable | Purpose | Default |
|---|---|---|
| `FRONTEND_ORIGINS` | Allowed CORS origins | any localhost port |
| `COOKIES_FROM_BROWSER` | Reuse a browser's login, e.g. `chrome` | off |
| `PROXY` | Route downloads through a proxy | off |
| `NEXT_PUBLIC_API_URL` | Backend URL for the frontend | `http://127.0.0.1:8000` |
| `MEDIA_TTL_HOURS` | How long media files are kept | `24` (new) |
| `MAX_UPLOAD_MB` | Upload size limit | `2048` (new) |
| `OLLAMA_URL` | Ollama server | `http://127.0.0.1:11434` (new) |
| `TRANSLATION_MODEL` | Ollama model for translation | `qwen3:8b` (new) |
| `HF_TOKEN` | Hugging Face token, only for multi-speaker diarization | off (new) |
| `RUNWAYML_API_SECRET` | Runway API key for AI styling in the Animate tab | off: only the offline preview look works |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Google OAuth client ("Desktop app" type, YouTube Data API v3 enabled) for publishing | off: publishing shows setup steps |
| `YOUTUBE_TOKEN_FILE` | Where the YouTube refresh token is saved. Never commit it. | `backend/youtube_token.json` |

## This machine (checked 2026-10-07)

- Apple M4, 16 GB RAM, macOS 26.6.
- **The disk is 99% full, with 3.6 GB free.** That's not enough for the AI work. (2026-10-08: 35 GB free.)
- There is no system ffmpeg. The backend uses the imageio-ffmpeg binary, which has no `ffprobe`.
- The system Python is 3.9. uv and Homebrew are installed.
- Ollama has `qwen3:8b` (5.2 GB) ready. It also has `qwen3.8:latest` (17 GB), `qwen2.5:7b` (4.7 GB) and `qwen2.5:3b` (1.9 GB).

## Decisions

These are already decided. Don't reopen them without a concrete reason.

| Area | Choice | Why |
|---|---|---|
| Video processing | Homebrew **ffmpeg + ffprobe**, called with argument lists (never `shell=True`) | Fast, and has every filter needed (libass, drawtext, xfade, loudnorm). MoviePy was rejected because it re-encodes slowly in Python. |
| How edits work | A non-destructive JSON **edit spec**, compiled into one ffmpeg command, and rendered as a new media item | The original is never touched, undo/redo is just spec history, and it's easy to test. |
| Text on video | **ASS subtitles rendered by libass** for all titles and captions | Shapes Arabic correctly and lays out right-to-left text. drawtext handles Arabic poorly. |
| Storage | **SQLite** (Python standard library) for media and jobs | Survives restarts, with no extra service. |
| Running jobs | One generic job runner with three pools: downloads (3), renders (2), AI (1) | 16 GB of RAM holds only one set of AI models at a time. |
| Speech to text | **faster-whisper `large-v3-turbo`** (int8) with VAD and word timestamps | MIT licence, accurate in many languages, and runs on the M4's CPU. |
| Voice vs background | **Demucs `htdemucs`** with two stems | MIT licence. Leaves the music and sound effects untouched. |
| Translation | **`qwen3:8b` through Ollama**, with thinking off and JSON output | Apache 2.0, already installed, and the best Arabic among models that fit in 16 GB. Aya Expanse is stronger but non-commercial at 8B and too big at 32B. |
| Arabic voice with cloning | **Chatterbox Multilingual** (Resemble AI), `language_id="ar"`, on MPS | MIT licence (commercial use allowed), supports Arabic, and clones a voice from about 10 s of audio. XTTS-v2 (non-commercial CPML) and F5-TTS (CC-BY-NC weights) were rejected. Its output carries an inaudible PerTh watermark. |
| Pitch matching | **pyworld** (WORLD vocoder): match the mean and range of log-F0 while keeping the spectral envelope | Keeps the speaker's pitch level and range without changing their timbre. |
| Fitting lines to time | ffmpeg **`atempo`** | Changes speed without changing pitch, and is already a dependency. |
| Loudness | **pyloudnorm** for each line, ffmpeg `loudnorm` for the final mix | Each line matches the original's loudness. |
| Arabic variety | **Modern Standard Arabic (Fusha)** | Understood everywhere, and has the best model support. |
| Python | **3.11** through uv in `backend/.venv` | The system Python 3.9 is too old for PyTorch and Chatterbox. |
| Later: speaker separation | pyannote `speaker-diarization-community-1` | Free, but needs a Hugging Face token. |
| Later: model to compare | OmniVoice (k2-fsa, 600+ languages) | Test it against Chatterbox once its licence is confirmed. |
| AI video styling (Animate) | **Runway API**: `aleph2` by default, `gemini_omni_flash` as the cheaper option. One fixed seed for every clip. An ffmpeg cartoon filter is a free offline preview, clearly labelled as not AI. | Aleph 2 restyles real footage and keeps motion and timing. It takes 2–30 s clips at up to 1080p and 30 fps, and accepts a seed. It costs 28 credits ($0.28) per second, with a 56-credit minimum. Picked on 2026-10-08 without asking the user, so confirm it. |
| Publishing (Animate) | **YouTube Data API v3** resumable `videos.insert`. OAuth installed-app flow (PKCE, loopback redirect to the backend), `youtube.upload` scope only. | No Google client libraries needed. The refresh token is saved with 0600 permissions. Uploads default to private. |
| HTTP client | **httpx** | Used for the Runway and YouTube calls. Already planned for the AI work. |

---

## P0: Machine setup

- [ ] **Free at least 25 GB of disk. Get the user's approval before deleting anything.** The biggest candidates:
  - The Ollama models `qwen3.8:latest` (17 GB, too big to run well in 16 GB of RAM), `qwen2.5:7b` (4.7 GB) and `qwen2.5:3b` (1.9 GB). Keep `qwen3:8b`.
  - The npm cache in `~/.npm` (8.6 GB): `npm cache clean --force`.
  - `~/Library/Caches` (16 GB).
  - `backend/downloads/` (60 MB).
- [ ] **Install ffmpeg with `brew install ffmpeg`.** Update [backend/services/ffmpeg.py](backend/services/ffmpeg.py) to find `ffprobe` too, and to check `ffmpeg -filters` for libass, xfade and vidstab. Report both in `/api/health`. If ffmpeg is missing, the editor endpoints should return a clear error.
- [ ] **Create a Python 3.11 venv**: `uv venv --python 3.11 backend/.venv`. Split the dependencies into:
  - `backend/requirements.txt`: core packages, plus `python-multipart` for uploads
  - `backend/requirements-ai.txt`: torch, faster-whisper, demucs, chatterbox-tts, pyworld, pyloudnorm, soundfile and httpx

  Pin every version.
- [ ] **Add `backend/scripts/download_models.py`.** It prefetches the Whisper, Demucs and Chatterbox weights and checks that Ollama has `qwen3:8b`. Add `ai: {ffprobe, ollama, models, device}` to `/api/health`.

## P0: Clean up before the first commit

The repo has no commits yet, and every file is untracked.

- [ ] **Decide what to do with the root `main.py` and `user_db.json`.** They are a separate FastAPI practice app for a users API, unrelated to this app. Move them into `playground/` or delete them. If you keep them, fix two things: the `User` model is never used, and `user_db.json` is opened with a relative path, so the app only works when started from the repo root.
- [ ] **Replace the root `requirements.txt`.** It is a `pip freeze` of the macOS system Python. It includes `file:///AppleInternal/...` wheels that won't install on any other machine. Delete it, since the backend has its own file.
- [ ] **Add a comment to [backend/requirements.txt](backend/requirements.txt)** saying yt-dlp needs regular updates, because YouTube and Instagram changes often break older versions.
- [ ] **Update the root [.gitignore](.gitignore).** Add `.env`, `backend/.venv/`, `backend/media/`, `backend/work/` and `*.db`.
- [ ] **Write a root `README.md`** that covers setup, running and the environment variables above. Also replace the default create-next-app text in [frontend/README.md](frontend/README.md).
- [ ] **Delete the unused create-next-app SVGs** in `frontend/public/`. Nothing in `src/` uses them.
- [ ] **Make the initial commit** once the tasks above are done. `backend/downloads/` (60 MB) and `frontend/.next/` are already ignored.

## P1: Foundation (needed by both the editor and dubbing)

- [ ] **Generic job runner.** Replace the internals of [backend/services/jobs.py](backend/services/jobs.py):
  - Job types: `download`, `render` and `dub`.
  - Status: `queued`, `running`, `awaiting_review`, `done`, `error` or `cancelled`, plus a `stage` name and `progress`.
  - Bounded pools as listed in Decisions. Downloads currently start a new thread per request with no limit.
  - Store jobs in SQLite so they survive restarts.
  - Update the `Job` type in [frontend/src/lib/api.ts](frontend/src/lib/api.ts) to match.
- [ ] **ffmpeg progress.** Run ffmpeg with `-progress pipe:1 -nostats`. Work out the percentage from `out_time_us` and the duration reported by ffprobe.
- [ ] **Cancel any job**: `POST /api/jobs/{id}/cancel`. How each type stops:
  - downloads: raise an exception from the yt-dlp hook
  - renders: kill the ffmpeg process
  - dubs: check a cancel flag between stages

  Delete the partial files afterwards.
- [ ] **Media library.** Every download, upload and render becomes a media item with an id. It stores the ffprobe metadata: duration, width, height, fps, codecs and whether it has audio. Files live in `backend/media/`, and the index is in SQLite. Endpoints:
  - `GET /api/media` and `GET /api/media/{id}`
  - `GET /api/media/{id}/stream`, which must support HTTP Range so the player can seek. Check that Starlette's `FileResponse` handles Range, and add it if not.
  - `GET /api/media/{id}/thumbnail`
  - `DELETE /api/media/{id}`
  - `POST /api/media/upload`: multipart, limited to `MAX_UPLOAD_MB`, and the file must pass an ffprobe check that it really is video or audio
- [ ] **Turn finished downloads into media items.** After a download finishes, the Downloader shows **Edit** and **Dub to Arabic** buttons next to the save link.
- [ ] **Clean up old files and jobs.** Nothing cleans up today: `backend/downloads/` and the in-memory `_jobs` dict only grow. Do these:
  - Delete media items and their jobs after `MEDIA_TTL_HOURS`.
  - Delete each job's work folder in `backend/work/{job_id}/` when the job ends. Keep it when `KEEP_WORK=1`, for debugging.
  - When the server starts, sweep away leftover `.part` files and orphaned work folders.

## P1: Video editor (as complete as possible)

### Backend

- [ ] **Edit spec schema.** Write a pydantic model in `backend/services/editor/spec.py`. Every field has bounds, and unknown fields are rejected. Example:
  ```json
  {
    "trim": {"start": 3.2, "end": 47.0},
    "cuts": [{"start": 10.0, "end": 12.5}],
    "crop": {"x": 0, "y": 0, "w": 608, "h": 1080}, "aspect": "9:16",
    "rotate": 90, "flip": "h", "speed": 1.25,
    "volume": 0.8, "fade": {"in": 0.5, "out": 1.0},
    "color": {"brightness": 0.05, "contrast": 1.1, "saturation": 1.2},
    "texts": [{"text": "مرحبا", "start": 1, "end": 4, "position": "bottom", "size": 48}],
    "output": {"format": "mp4", "quality": "high", "height": 1080}
  }
  ```
- [ ] **Spec compiler.** In `backend/services/editor/compile.py`, turn a spec into a single ffmpeg argument list with one filtergraph. Cover it with golden tests that check spec → expected arguments.
- [ ] **Endpoints.** Add these:
  - `POST /api/edit/render {media_id, spec}`: starts a render job that creates a new media item
  - `POST /api/edit/frame {media_id, spec, t}`: returns a JPEG of the frame at time `t` with the spec applied, for an exact preview of crop and color
- [ ] **Phase 1: core edits.**
  - Trim the start and end.
  - Cut out sections from the middle (trim + concat).
  - Split a clip at a point into two media items.
  - Crop freely or with the 16:9, 9:16, 1:1 and 4:5 presets, including a "fit with blurred background" option for turning landscape video vertical.
  - Resize to 2160, 1440, 1080, 720, 480 or 360p.
  - Rotate 90/180/270 and flip horizontally or vertically.
  - Change speed from 0.25× to 4× (`setpts` + chained `atempo`).
  - Set volume from 0 to 200%, mute, and fade audio in and out.
  - Fade video in and out from black.
  - Save a single frame as PNG or JPG.
- [ ] **Phase 1: export.**
  - MP4 (H.264 + AAC, the default), WebM (VP9 + Opus) or MOV.
  - Quality presets: high, medium and small (CRF 18/23/28), or a target size in MB using two-pass encoding.
  - A "fast export" toggle that uses `h264_videotoolbox`.
  - GIF using palettegen/paletteuse, up to 15 s and 720 px wide.
  - Audio only as MP3, M4A or WAV.
- [ ] **Phase 2: creative edits.**
  - Timed text overlays: position, size, color, outline or box. Arabic and right-to-left text use ASS and a bundled font.
  - A logo or image watermark: position, opacity and scale.
  - Color: brightness, contrast, saturation and gamma, plus B&W, sepia, vivid, warm and cool presets.
  - Blur, sharpen, vignette and video denoise (`hqdn3d`).
- [ ] **Phase 2: combining clips.**
  - Merge several clips. Scale and pad them to the first clip's resolution and fps, and add silence to clips with no audio.
  - Crossfade between clips (`xfade` + `acrossfade`).
  - Picture-in-picture.
  - Reverse, limited to clips of 60 s or less because it uses a lot of memory.
  - Stabilize, only when ffmpeg includes vidstab.
- [ ] **Phase 2: audio.**
  - Replace a clip's audio.
  - Add background music that lowers automatically under speech (`sidechaincompress`).
  - Normalize loudness to −14 LUFS.
  - Reduce noise (`afftdn`).
- [ ] **Phase 3: AI-assisted edits.** These share models with dubbing.
  - Automatic captions with faster-whisper. Download them as SRT or VTT, edit them in the UI, or burn them in with a style.
  - Translate captions into Arabic with `qwen3:8b`.
  - Remove silences for jump cuts (`silencedetect`, with a threshold and minimum length).
  - Mark scene changes on the timeline (PySceneDetect, BSD licence).

### Frontend

- [ ] **Library page `/library`.** A grid of media items with thumbnails, an upload drop zone, and delete, Edit and Dub to Arabic actions.
- [ ] **Editor page `/editor/[id]`.** It needs:
  - a video player
  - a timeline with a thumbnail strip, trim handles, cut ranges and a split point
  - a draggable crop box with aspect presets
  - tool tabs: Trim, Crop, Adjust, Text, Audio, Speed and Export
  - a live preview through CSS (filters, rotation, playback rate), with `/api/edit/frame` for an exact still
  - undo and redo through spec history
  - an export dialog and render progress
- [ ] **Arabic text in the UI.** Text inputs use `dir="auto"`. Bundle Noto Sans Arabic (OFL licence) for the UI. Also copy it to `backend/assets/fonts/` and use it as libass's `fontsdir` for burned-in text.

## P1: Arabic dubbing in the speaker's own voice and pitch

**Goal:** only the spoken language changes. Everything else stays as it was:

| Must stay the same | How |
|---|---|
| Video frames | Copied bit for bit (`-c:v copy`) |
| Music and sound effects | The Demucs background stem, used as is |
| Timing | Each Arabic line starts where the original started and ends before the next line |
| Speaker's voice | Cloned from that speaker's own clean speech |
| Pitch | Median and range within 0.5 semitone of the original speaker |
| Loudness | Each line within 1 dB of the original |
| The original file | Never changed. The dub is a new media item that keeps the original audio as a second track. |

Pipeline (`backend/services/dubbing/`; each step is a job stage):

- [ ] **D1. Extract audio.** Use ffmpeg to make two files: a WAV at the original sample rate for mixing, and a 16 kHz mono file for speech recognition. Work in `backend/work/{job_id}/`.
- [ ] **D2. Separate voice from background.** Run Demucs `htdemucs --two-stems=vocals` to get `vocals.wav` and `no_vocals.wav`. For long videos, use `--segment` to stay within 16 GB of RAM.
- [ ] **D3. Transcribe.** Run faster-whisper `large-v3-turbo` on `vocals.wav`, with VAD, word timestamps and automatic language detection.
  - If the video is already in Arabic, stop with a clear message.
  - Group words into lines. Break at the end of a sentence or at pauses of 0.4 s or more, with at most about 12 s per line.
  - Save `script.json` with each line's id, start, end, speaker and source text.
- [ ] **D4. Translate into Arabic.** Call `qwen3:8b` through the Ollama HTTP API with `think: false`, temperature 0.3, a JSON schema in `format`, and `keep_alive: 0` so its RAM is freed for TTS.
  - Send lines in batches of about 20, with the lines around them for context.
  - Give each line a length budget based on its duration, so the Arabic fits.
  - Ask for natural spoken Modern Standard Arabic, and keep names and numbers unchanged.
  - Check the response: the same line count and ids, with Arabic script in every line. Retry once if the check fails.
- [ ] **D5. Optional review step.** With `review: true`, the job pauses at `awaiting_review`. The UI shows a table of time, original text and editable Arabic (`dir="rtl"`). `PUT /api/dub/{job_id}/script` saves the edits and resumes the job.
- [ ] **D6. Pick a voice reference for each speaker.** From `vocals.wav`, choose 8–12 s of the speaker's clearest speech: loud, with no music bleeding through and no one else talking. Trim the silences and save it as `ref_{speaker}.wav`.
- [ ] **D7. Generate Arabic speech.** Use Chatterbox Multilingual with `language_id="ar"`, `audio_prompt_path=ref`, on `mps` (CPU as a fallback).
  - Start with `exaggeration=0.5`.
  - The reference clip is in another language, so follow Chatterbox's README and lower `cfg_weight` (try 0 to 0.3) to reduce accent carry-over. Choose the final value in D14.
  - Use a fixed seed so re-runs give the same result, and free the model when the stage ends.
- [ ] **D8. Match pitch (requirement 3).** For each speaker, measure F0 on the voiced frames of the original and of the dub with pyworld `harvest`, in semitones.
  - Shift the dub so the mean and spread of its log-F0 match the original. This keeps the Arabic intonation, at the speaker's own pitch level and range.
  - Resynthesize with WORLD, keeping the spectral envelope and aperiodicity unchanged, so the timbre doesn't change.
  - Skip the resynthesis when the dub is already within 0.5 semitone, since WORLD adds slight artifacts.
  - Write a report line for every line: the original's median F0, and the dub's before and after.
- [ ] **D9. Match loudness and fit the timing.**
  - Resample each line to the mix's sample rate, and match its LUFS to the original line with pyloudnorm.
  - A line's window runs from its original start to the next line's start, or to its end plus 0.3 s for the last line.
  - Too long, by up to 1.25×: speed it up with `atempo`.
  - Too long, by more than 1.25×: ask Ollama for a shorter translation (two tries at most), repeat D7–D8, then use `atempo` up to a hard limit of 1.35×. If it still doesn't fit, let it run into the gap and flag it in the report.
  - Too short: pad it with silence. Never slow it below 0.9×.
- [ ] **D10. Mix.**
  - Place each line at its original start time over `no_vocals.wav`, which stays unchanged.
  - Add 10 ms fades at the edges of each line to prevent clicks.
  - Match the overall loudness to the original mix, with a −1 dBTP limit.
- [ ] **D11. Combine with the video.**
  - Use `-map 0:v -c:v copy` so the video isn't re-encoded.
  - Track 1 is the Arabic audio (`language=ara`, the default). Track 2 is the original audio.
  - Also write `{name}.ar.srt`.
  - Save the result as a new media item.
- [ ] **D12. API.**
  - `POST /api/dub {media_id, target_language: "ar", review: false}` returns a job id.
  - The job's stages are extracting, separating, transcribing, translating, awaiting_review, synthesizing, matching, mixing and muxing.
  - `GET /api/dub/{job_id}/script` returns the transcript and translation. `GET /api/dub/{job_id}/report` returns the pitch, loudness and timing report.
- [ ] **D13. UI.**
  - A **Dub to Arabic** button on media items and in the editor.
  - A required checkbox: "I own this video or have permission to use this voice".
  - A stage-by-stage progress display.
  - The review table.
  - A player toggle between the original and the Arabic.
  - Downloads for the MP4 and the SRT.
- [ ] **D14. Quality check (acceptance).** Test on four clips: a male speaker, a female speaker, speech over music, and a clip of about 5 minutes. All of these must hold:
  - The video stream is unchanged: `ffmpeg -i X -map 0:v -c copy -f md5 -` gives the same hash for the input and the output.
  - The output is within 0.1 s of the original's duration.
  - Each speaker's median F0 is within 0.5 semitone of the original.
  - Each line's loudness is within 1 dB of the original.

  Also record two more numbers, and set their pass thresholds after the first run:
  - speaker similarity: cosine similarity between the original and dubbed vocals, using SpeechBrain `spkrec-ecapa-voxceleb` (Apache 2.0)
  - Arabic character error rate: have Whisper transcribe the dub and compare it with the intended text

  Record how long dubbing takes per minute of video on the M4.
- [ ] **D15. Fit in 16 GB of RAM.**
  - Run one AI job at a time.
  - Load each model only for its stage, then release it (`del`, `gc.collect()`, `torch.mps.empty_cache()`).
  - Use Ollama's `keep_alive: 0`.
  - Test with a 10-minute video and keep peak memory under about 12 GB, measured with `psutil`.

## P1: Security (required before the app runs anywhere but localhost)

- [ ] **Block requests to internal addresses (SSRF).** `/api/info` and `/api/download` accept any http(s) URL, and yt-dlp's generic extractor fetches it from the server. Someone could use this to read `http://169.254.169.254/` or services on `localhost`. In `get_service` in [backend/services/\_\_init\_\_.py](backend/services/__init__.py), resolve the hostname and reject private, loopback and link-local IPs.
- [ ] **Add per-IP rate limits** to `/api/info`, `/api/download`, `/api/media/upload`, `/api/edit/render` and `/api/dub`.
- [ ] **Keep user input out of ffmpeg commands.** Build ffmpeg arguments as lists, never through a shell. User text goes only into ASS files, never onto the command line. Fonts come from an allowlist. Bound output size and duration in the spec: at most 4K and the source's duration.
- [ ] **Validate uploads.** Enforce the size limit, require an ffprobe check, and generate the stored filename on the server. Never use a path from the client.
- [ ] **Never set `COOKIES_FROM_BROWSER` on a public server.** It lets anyone who can reach the API download with your logged-in accounts. Add a warning to the README and to [backend/config.py](backend/config.py).
- [ ] **Keep Ollama on localhost.** Never expose port 11434.
- [ ] **Review ID strength.** A 12-character hex job ID is the only thing that protects `/api/file/{job_id}`, and media IDs will do the same for media files. That is fine on localhost, but review it before going public.

## P1: Animate pipeline follow-ups

- [ ] **Try Runway with a real key** on a short clip you own. Check the `aleph2` output's resolution, frame rate and audio, and compare the credits charged with the estimate in the UI.
- [ ] **Do a real YouTube upload** (private) with an OAuth client. Check that the "made for kids" answer and the altered-content label show in YouTube Studio.
- [ ] **Keep Animate projects across backend restarts.** The browser saves the project, but media ids live in the backend's memory, so a restart breaks every link. This depends on the media library task.
- [ ] **Cancel a styling job** between clips, so a long Runway run can stop without paying for the rest. This depends on the cancel task.
- [ ] **Keep characters consistent with a reference image.** Aleph 2 accepts up to 5 keyframe images. Test whether a styled frame of the main character, passed to every clip, keeps the character's look better than the shared seed alone.
- [ ] **Connect to Google faster on networks with broken IPv6.** `www.googleapis.com` resolves to 8 IPv6 addresses before IPv4. Python tries them one at a time, so even with the 5 s connect timeout, the first connection can take about 40 s.

## P2: Dubbing improvements

- [ ] **Multiple speakers.** Use pyannote `speaker-diarization-community-1` (needs `HF_TOKEN`) to label each line with its speaker. Each speaker then gets their own voice reference and pitch statistics.
- [ ] **Compare OmniVoice with Chatterbox** on the D14 test clips. Switch only if it scores better on both similarity and error rate, and its licence allows commercial use.
- [ ] **Arabic diacritics.** If D14 shows mispronounced words, test adding diacritics (tashkeel) before TTS, and compare the error rate with and without them.
- [ ] **Dialects.** Offer Egyptian, Gulf and Levantine Arabic in the translation prompt, and check TTS quality for each.
- [ ] **Lip sync, opt-in only.** LatentSync (Apache 2.0) is a candidate. It changes the video frames, which breaks the "change nothing but the language" rule, so it stays off by default.
- [ ] **Other target languages.** The pipeline is already language-neutral, apart from the translation prompt and the TTS language id.

## P2: Frontend

- [ ] **Retry failed progress checks.** In [Downloader.tsx](frontend/src/components/Downloader.tsx), one failed `getProgress` call stops polling for good and shows an error. Retry a few times before giving up. Use the same polling hook for downloads, renders and dubs.
- [ ] **Keep one platform list.** `PLATFORMS` in [page.tsx](frontend/src/app/page.tsx) and `PLATFORM_NAMES` in `Downloader.tsx` overlap. Move them into `src/lib/`.
- [ ] **Cancel button and queued state** for every job type. These depend on the generic job runner.
- [ ] **Show an estimated file size** for each download quality, using yt-dlp's `filesize` or `filesize_approx`.

## P2: Tests

There are no tests yet. Mark tests that need AI models with `@pytest.mark.ai`, and skip them by default.

- [ ] **Backend unit tests (pytest, no network).** Cover:
  - `get_service` routing: domains, subdomains, bad schemes and missing hosts
  - `validate_quality`
  - `format_options` with and without ffmpeg
  - error messages from `to_service_error`
  - `get_info` handling of playlists with empty entries, with yt-dlp mocked
- [ ] **Editor tests.** Two kinds:
  - golden tests for the spec compiler
  - render tests on a 5 s test clip made with `ffmpeg -f lavfi -i testsrc2=duration=5:size=1280x720:rate=30 -f lavfi -i sine=frequency=440:duration=5`, checking the output's duration, size and streams with ffprobe

  No copyrighted test media.
- [ ] **Animate tests.** Golden tests for `scenes.plan_clips`, `combine.build_command` (cut, crossfade and fade through black, with and without audio) and `soundtrack.build_command`. Also a render test on the synthetic three-scene clip from the editor tests. Check:
  - the output duration matches what the builder returns
  - the video stream is unchanged after the soundtrack step (same `-f md5`)
  - the mix lands near −14 LUFS
- [ ] **Dubbing unit tests.** Cover:
  - grouping words into lines
  - the length budget
  - the timing-fit decisions
  - the pitch-shift math, on a synthetic tone sweep
  - checks on Ollama responses, with Ollama mocked
- [ ] **API tests with FastAPI `TestClient`.** Cover:
  - `/api/health`
  - a 400 response for a bad URL
  - 404 responses for an unknown job or media item
  - a 404 response for a file that isn't ready
  - an upload that is too big
  - a spec that is out of bounds
- [ ] **Frontend checks.** Make sure `npm run lint` and `npm run build` pass.
- [ ] **Manual smoke test.** Try one link from each platform at best quality, at a specific height and as audio. Repeat once without ffmpeg. Then edit one clip with every phase 1 tool, and dub one clip from start to finish.

## Later / ideas

- [ ] Download the whole playlist or carousel. Right now only the first item is downloaded, because of `playlist_items: "1"`.
- [ ] Keep a download history.
- [ ] Reframe landscape video to vertical automatically by following faces.
- [ ] Batch-dub a playlist.

---

## Done

<!-- Move finished tasks here as: - [x] YYYY-MM-DD: task (one-line note on what changed and how it was verified) -->

- [x] 2026-10-08: **Animate tab**, the six-step pipeline: original video (rights check) → split into clips (scene detection, 2–30 s, at most 1080p and 30 fps) → AI styling (Runway, or the offline preview) → combine (reorder, cut, crossfade or fade through black, last and first frame of each join for continuity) → audio (narration, music that ducks under speech, −14 LUFS) → publish to YouTube (OAuth, made-for-kids answer, altered-content label, rights and monetization checklist). Verified on synthetic media: an API end-to-end script, then the full UI flow in headless Chrome. The combined length matches the transitions exactly, the soundtrack step copies the video stream unchanged (same md5), the mix measures −14.5 LUFS, and the music ducks about 8 dB. The upload error path was tested with a fake token. `npm run lint`, `tsc` and `npm run build` pass. Not tried with a real Runway key or a real YouTube upload; see the follow-ups.
