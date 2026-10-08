"use client";

import { useState } from "react";
import { ContinueButton, isRunning, JobProgress, Note, stem, type StepProps } from "@/components/animate/common";
import FilePicker from "@/components/FilePicker";
import { buttonClass, Checkbox, Field, inputClass, primaryButtonClass, saveLinkClass, Slider } from "@/components/ui";
import { fileUrl, startSoundtrack, type Job, type MediaInfo } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useJob } from "@/lib/useJob";

export default function AudioStep({ project, update, onNext }: StepProps) {
  const combined = project.combined!;
  const [originalVolume, setOriginalVolume] = useState(1);
  const [narration, setNarration] = useState<MediaInfo | null>(null);
  const [narrationVolume, setNarrationVolume] = useState(1);
  const [narrationStart, setNarrationStart] = useState("0");
  const [music, setMusic] = useState<MediaInfo | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.25);
  const [duck, setDuck] = useState(true);
  const [normalize, setNormalize] = useState(true);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [filename, setFilename] = useState(() => `${stem(project.source?.filename ?? "video")} - final`);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const job = useJob(jobId, (done: Job) => {
    if (jobId) update({ final: { id: jobId, filename: done.filename ?? "final.mp4" }, published: null });
  });

  const start = Number(narrationStart);
  const startValid = narrationStart.trim() !== "" && Number.isFinite(start) && start >= 0;
  const needsRights = narration !== null || music !== null;
  const busy = isRunning(jobId, job, starting);
  const canBuild = !busy && startValid && (!needsRights || rightsConfirmed);

  async function handleBuild() {
    setStarting(true);
    setStartError(null);
    setJobId(null);
    try {
      const { job_id } = await startSoundtrack({
        video_id: combined.id,
        original_volume: originalVolume,
        narration_id: narration?.id ?? null,
        narration_volume: narrationVolume,
        narration_start: startValid ? start : 0,
        music_id: music?.id ?? null,
        music_volume: musicVolume,
        duck_music: duck,
        normalize,
        audio_rights_confirmed: rightsConfirmed,
        filename,
      });
      setJobId(job_id);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Slider
        label="Original sound from the clips"
        value={originalVolume}
        max={2}
        onChange={setOriginalVolume}
        display={originalVolume === 0 ? "Muted" : `${Math.round(originalVolume * 100)}%`}
      />

      <AudioSlot title="Narration" media={narration} onRemove={() => setNarration(null)} picker={
        <FilePicker label="Add narration" hint="A voice-over you recorded: MP3, M4A or WAV" accept="audio/*,video/*" onUploaded={setNarration} />
      }>
        <Slider label="Narration volume" value={narrationVolume} max={2} onChange={setNarrationVolume} display={`${Math.round(narrationVolume * 100)}%`} />
        <Field label="Starts at (seconds)">
          <input type="number" min={0} step={0.1} value={narrationStart} onChange={(e) => setNarrationStart(e.target.value)} className={inputClass} />
        </Field>
      </AudioSlot>

      <AudioSlot title="Background music" media={music} onRemove={() => setMusic(null)} picker={
        <FilePicker label="Add music" hint="Repeats if shorter than the video, and fades out at the end" accept="audio/*,video/*" onUploaded={setMusic} />
      }>
        <Slider label="Music volume" value={musicVolume} max={1} onChange={setMusicVolume} display={`${Math.round(musicVolume * 100)}%`} />
        <Checkbox checked={duck} onChange={setDuck}>
          Lower the music while someone is speaking
        </Checkbox>
      </AudioSlot>

      <Checkbox checked={normalize} onChange={setNormalize}>
        Match YouTube&apos;s loudness (about −14 LUFS), so YouTube doesn&apos;t turn the video down
      </Checkbox>

      {needsRights && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
          <Checkbox checked={rightsConfirmed} onChange={setRightsConfirmed}>
            I made this music and narration, or I have licenses that cover monetized YouTube videos.
          </Checkbox>
          <Note>
            Tracks from the YouTube Audio Library are free to use in YouTube videos. Some need a credit in the description,
            so check each track&apos;s terms.
          </Note>
        </div>
      )}

      <Field label="File name">
        <div className="flex items-center gap-2">
          <input value={filename} onChange={(e) => setFilename(e.target.value)} className={inputClass} />
          <span className="text-sm text-zinc-500">.mp4</span>
        </div>
      </Field>

      <button onClick={handleBuild} disabled={!canBuild} className={primaryButtonClass}>
        {busy ? "Building..." : "Build final video"}
      </button>
      <button
        type="button"
        onClick={() => update({ final: combined, published: null })}
        disabled={busy}
        className={buttonClass}
      >
        Skip: keep the combined video&apos;s sound as it is
      </button>
      <JobProgress jobId={jobId} job={job} starting={starting} startError={startError} />

      {project.final && (
        <div className="flex flex-col gap-3">
          <video src={fileUrl(project.final.id, false)} controls preload="metadata" className="max-h-80 w-full rounded-xl bg-black" />
          <a href={fileUrl(project.final.id)} className={saveLinkClass}>
            Save {project.final.filename}
          </a>
          <ContinueButton onClick={onNext}>Continue to publishing</ContinueButton>
        </div>
      )}
    </div>
  );
}

function AudioSlot({ title, media, onRemove, picker, children }: {
  title: string;
  media: MediaInfo | null;
  onRemove: () => void;
  picker: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-xs text-zinc-500">{title}</p>
      {media ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800">
            <span className="truncate">
              {media.filename} <span className="text-zinc-500">· {formatDuration(media.duration)}</span>
            </span>
            <button type="button" onClick={onRemove} className="shrink-0 text-xs text-red-600 dark:text-red-400">
              Remove
            </button>
          </div>
          {children}
        </div>
      ) : (
        picker
      )}
    </div>
  );
}
