"use client";

import { useEffect, useRef, useState } from "react";
import FilePicker from "@/components/FilePicker";
import { fileUrl, getMedia, startEdit, type EditSource, type MediaInfo } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useJob } from "@/lib/useJob";

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const inputClass =
  "w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700";
const buttonClass =
  "rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

type Props = {
  source: EditSource | null;
  onSourceChange: (source: EditSource | null) => void;
};

export default function Editor({ source, onSourceChange }: Props) {
  if (!source) {
    return (
      <Card title="Edit a video">
        <FilePicker
          large
          label="Drop a video here, or click to choose"
          hint="MP4, MOV, WebM, MKV or audio files. You can also download a video and press Edit."
          accept="video/*,audio/*"
          onUploaded={(media) => onSourceChange({ id: media.id })}
        />
      </Card>
    );
  }
  // key resets the whole form when a different file is opened.
  return <MediaLoader key={source.id} source={source} onSourceChange={onSourceChange} />;
}

function MediaLoader({ source, onSourceChange }: { source: EditSource } & Pick<Props, "onSourceChange">) {
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMedia(source.id)
      .then((m) => !cancelled && setMedia(m))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [source.id]);

  if (error) {
    return (
      <Card title="Edit a video">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button onClick={() => onSourceChange(null)} className={`${buttonClass} mt-3`}>
          Choose another file
        </button>
      </Card>
    );
  }
  if (!media) return <Card title="Edit a video"><p className="text-sm text-zinc-500">Loading...</p></Card>;
  return <EditForm media={media} fallbackTitle={source.title} onSourceChange={onSourceChange} />;
}

function EditForm({ media, fallbackTitle, onSourceChange }: { media: MediaInfo; fallbackTitle?: string } & Pick<Props, "onSourceChange">) {
  const stem = media.filename.replace(/\.[^.]+$/, "");
  const extension = media.has_video ? ".mp4" : ".mp3";
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [trimStart, setTrimStart] = useState("0");
  const [trimEnd, setTrimEnd] = useState(String(media.duration));
  const [speed, setSpeed] = useState(1);
  const [originalVolume, setOriginalVolume] = useState(1);
  const [music, setMusic] = useState<MediaInfo | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.3);
  const [filename, setFilename] = useState(stem);
  const [title, setTitle] = useState(media.details.title || fallbackTitle || stem);
  const [altText, setAltText] = useState(media.details.alt_text);
  const [tags, setTags] = useState(media.details.tags);
  const [author, setAuthor] = useState(media.details.author);

  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const job = useJob(jobId);

  const start = Number(trimStart);
  const end = Number(trimEnd);
  const trimValid =
    trimStart.trim() !== "" && trimEnd.trim() !== "" &&
    Number.isFinite(start) && Number.isFinite(end) &&
    start >= 0 && end > start + 0.05 && end <= media.duration + 0.05;
  const outputLength = trimValid ? (end - start) / speed : null;
  const busy = starting || job?.status === "processing" || job?.status === "downloading";

  function playheadTime() {
    const player = videoRef.current ?? audioRef.current;
    return player ? player.currentTime.toFixed(1) : null;
  }

  async function handleExport() {
    setStarting(true);
    setExportError(null);
    setJobId(null);
    try {
      const { job_id } = await startEdit({
        source_id: media.id,
        trim_start: start > 0 ? start : 0,
        trim_end: end >= media.duration - 0.05 ? null : end,
        speed,
        original_volume: originalVolume,
        music_id: music?.id ?? null,
        music_volume: musicVolume,
        filename,
        title,
        alt_text: altText,
        tags,
        author,
      });
      setJobId(job_id);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={media.filename}
        action={
          <button onClick={() => onSourceChange(null)} className={buttonClass}>
            Open another file
          </button>
        }
      >
        {media.has_video ? (
          <video
            ref={videoRef}
            src={fileUrl(media.id, false)}
            controls
            preload="metadata"
            className="max-h-[420px] w-full rounded-xl bg-black"
          />
        ) : (
          <audio ref={audioRef} src={fileUrl(media.id, false)} controls preload="metadata" className="w-full" />
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Length {formatDuration(media.duration)}
          {!media.has_audio && " · no audio track"}
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Trim">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Start (seconds)", value: trimStart, set: setTrimStart },
              { label: "End (seconds)", value: trimEnd, set: setTrimEnd },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-500">{label}</label>
                <input
                  type="number"
                  min={0}
                  max={media.duration}
                  step={0.1}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => {
                    const t = playheadTime();
                    if (t !== null) set(t);
                  }}
                  className={buttonClass}
                >
                  Use current time
                </button>
              </div>
            ))}
          </div>
          <p className={`mt-3 text-xs ${trimValid ? "text-zinc-500" : "text-red-600 dark:text-red-400"}`}>
            {trimValid
              ? `Keeping ${formatDuration(start)} to ${formatDuration(end)}`
              : `Start must be before end, within 0 to ${media.duration} seconds`}
          </p>
        </Card>

        <Card title="Speed">
          <div className="flex flex-wrap gap-2">
            {SPEED_PRESETS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  speed === s
                    ? "bg-indigo-600 text-white"
                    : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="mt-4 w-full accent-indigo-600"
            aria-label="Speed"
          />
          <p className="mt-1 text-xs text-zinc-500">
            {speed}x{outputLength !== null && ` · new length ${formatDuration(outputLength)}`}. Voices keep their pitch.
          </p>
        </Card>

        <Card title="Audio">
          {media.has_audio ? (
            <Slider
              label="Original sound"
              value={originalVolume}
              max={2}
              onChange={setOriginalVolume}
              display={originalVolume === 0 ? "Muted" : `${Math.round(originalVolume * 100)}%`}
            />
          ) : (
            <p className="text-xs text-zinc-500">This file has no original sound.</p>
          )}

          <div className="mt-4">
            <p className="mb-2 text-xs text-zinc-500">Background music</p>
            {music ? (
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800">
                  <span className="truncate">{music.filename}</span>
                  <button type="button" onClick={() => setMusic(null)} className="shrink-0 text-xs text-red-600 dark:text-red-400">
                    Remove
                  </button>
                </div>
                <div className="mt-3">
                  <Slider
                    label="Music volume"
                    value={musicVolume}
                    max={1}
                    onChange={setMusicVolume}
                    display={`${Math.round(musicVolume * 100)}%`}
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-500">Repeats if it&apos;s shorter than the video.</p>
              </>
            ) : (
              <FilePicker
                label="Add music"
                hint="MP3, M4A, WAV, or a video to take the sound from"
                accept="audio/*,video/*"
                onUploaded={setMusic}
              />
            )}
          </div>
        </Card>

        <Card title="Details">
          <div className="flex flex-col gap-3">
            <Field label="File name">
              <div className="flex items-center gap-2">
                <input value={filename} onChange={(e) => setFilename(e.target.value)} className={inputClass} />
                <span className="text-sm text-zinc-500">{extension}</span>
              </div>
            </Field>
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Alt text / description" hint="Saved in the file as its description.">
              <textarea
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                rows={3}
                placeholder="Describe what happens in the video"
                className={inputClass}
              />
            </Field>
            <Field label="Tags" hint="Separate with commas.">
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="product, launch, promo"
                className={inputClass}
              />
            </Field>
            <Field label="Author">
              <input value={author} onChange={(e) => setAuthor(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </Card>
      </div>

      <Card title="Export">
        <button
          onClick={handleExport}
          disabled={busy || !trimValid}
          className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {busy ? "Exporting..." : `Export ${filename.trim() || "video"}${extension}`}
        </button>

        {exportError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{exportError}</p>}

        {jobId && job?.status !== "done" && job?.status !== "error" && (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-indigo-600 transition-[width] duration-300"
                style={{ width: `${job?.progress ?? 0}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-zinc-500">{job ? `${job.progress}%` : "Starting..."}</p>
          </div>
        )}

        {job?.status === "error" && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{job.error}</p>}

        {job?.status === "done" && jobId && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <a
              href={fileUrl(jobId)}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Save {job.filename}
            </a>
            <button
              onClick={() => onSourceChange({ id: jobId, title })}
              className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Keep editing this version
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </label>
  );
}

function Slider(props: { label: string; value: number; max: number; onChange: (v: number) => void; display: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{props.label}</span>
        <span>{props.display}</span>
      </div>
      <input
        type="range"
        min={0}
        max={props.max}
        step={0.05}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-1 w-full accent-indigo-600"
        aria-label={props.label}
      />
    </div>
  );
}
