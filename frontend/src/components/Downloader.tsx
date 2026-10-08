"use client";

import { useState } from "react";
import { fileUrl, getInfo, startDownload, type EditSource, type VideoInfo } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useJob } from "@/lib/useJob";

const PLATFORMS = ["YouTube", "Facebook", "Instagram", "Dailymotion", "TikTok", "X / Twitter", "Vimeo"];

const PLATFORM_NAMES: Record<string, string> = {
  Youtube: "YouTube",
  YoutubeTab: "YouTube",
  FacebookReel: "Facebook",
  InstagramStory: "Instagram",
  DailyMotion: "Dailymotion",
  Twitter: "X / Twitter",
};

export default function Downloader({ onEdit }: { onEdit: (source: EditSource) => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [quality, setQuality] = useState("best");
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const job = useJob(jobId);

  async function handleFetch(e: React.FormEvent) {
    e.preventDefault();
    const link = url.trim();
    if (!link) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    setJobId(null);
    setStartError(null);
    setThumbFailed(false);
    try {
      setInfo(await getInfo(link));
      setQuality("best");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    setStarting(true);
    setStartError(null);
    setJobId(null);
    try {
      const { job_id } = await startDownload(url.trim(), quality);
      setJobId(job_id);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function handlePaste() {
    try {
      setUrl(await navigator.clipboard.readText());
    } catch {
      // Clipboard permission denied; the user can paste manually.
    }
  }

  const busy = starting || (jobId !== null && job?.status !== "done" && job?.status !== "error");
  const platform = info?.platform ? (PLATFORM_NAMES[info.platform] ?? info.platform) : null;
  const meta = [info?.uploader, formatDuration(info?.duration)].filter(Boolean).join(" · ");

  return (
    <div className="flex w-full flex-col gap-4">
      <ul className="mb-2 flex flex-wrap justify-center gap-2">
        {PLATFORMS.map((name) => (
          <li
            key={name}
            className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
          >
            {name}
          </li>
        ))}
        <li className="px-1 py-1 text-xs text-zinc-400">and many more</li>
      </ul>

      <form
        onSubmit={handleFetch}
        className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm sm:flex-row dark:border-zinc-800 dark:bg-zinc-900"
      >
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a video link from YouTube, Facebook, Instagram, Dailymotion..."
          className="min-w-0 flex-1 rounded-xl bg-transparent px-4 py-3 text-base outline-none placeholder:text-zinc-400"
          autoFocus
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePaste}
            className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 sm:flex-none dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Paste
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 sm:flex-none"
          >
            {loading ? "Loading..." : "Get video"}
          </button>
        </div>
      </form>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      {info && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-4 sm:flex-row">
            {info.thumbnail && !thumbFailed ? (
              // Thumbnails come from many different CDNs, so a plain <img> is simpler than next/image here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={info.thumbnail}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setThumbFailed(true)}
                className="aspect-video w-full rounded-xl bg-zinc-100 object-cover sm:w-48 dark:bg-zinc-800"
              />
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-zinc-100 text-sm text-zinc-400 sm:w-48 dark:bg-zinc-800">
                No preview
              </div>
            )}
            <div className="min-w-0 flex-1">
              {platform && (
                <span className="mb-2 inline-block rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {platform}
                </span>
              )}
              <h2 className="line-clamp-2 font-semibold">{info.title}</h2>
              {meta && <p className="mt-1 text-sm text-zinc-500">{meta}</p>}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={busy}
              className="flex-1 rounded-xl border border-zinc-200 bg-transparent px-3 py-3 text-sm dark:border-zinc-700"
            >
              <option value="best">Best quality (MP4)</option>
              {info.heights
                .filter((h) => h >= 144)
                .map((h) => (
                  <option key={h} value={String(h)}>
                    {h}p
                  </option>
                ))}
              <option value="audio">Audio only ({info.ffmpeg ? "MP3" : "M4A"})</option>
            </select>
            <button
              onClick={handleDownload}
              disabled={busy}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? "Downloading..." : "Download"}
            </button>
          </div>

          {!info.ffmpeg && (
            <p className="mt-3 text-xs text-zinc-500">
              ffmpeg wasn&apos;t found on the backend, so only formats that already include audio can be downloaded.
            </p>
          )}

          {startError && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{startError}</p>}

          {(starting || jobId) && job?.status !== "done" && job?.status !== "error" && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-[width] duration-300"
                  style={{ width: `${job?.progress ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-zinc-500">
                {!job && "Starting..."}
                {job?.status === "downloading" &&
                  [`${job.progress}%`, job.speed, job.eta && `ETA ${job.eta}`].filter(Boolean).join(" · ")}
                {job?.status === "processing" && "Processing..."}
              </p>
            </div>
          )}

          {job?.status === "error" && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{job.error}</p>}

          {job?.status === "done" && jobId && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <a
                href={fileUrl(jobId)}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Save {job.filename}
              </a>
              <button
                onClick={() => onEdit({ id: jobId, title: info.title })}
                className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Edit video
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
