"use client";

import { useState } from "react";
import { CLEAR_AFTER_STYLE, ContinueButton, isRunning, JobProgress, Note, Thumb, type StepProps } from "@/components/animate/common";
import { ErrorText, Field, inputClass, primaryButtonClass, Slider } from "@/components/ui";
import { startSplit, type Job } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useJob } from "@/lib/useJob";

export default function SplitStep({ project, update, onNext }: StepProps) {
  const [useScenes, setUseScenes] = useState(true);
  const [threshold, setThreshold] = useState(0.3);
  const [minSeconds, setMinSeconds] = useState("2");
  const [maxSeconds, setMaxSeconds] = useState("10");
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const job = useJob(jobId, (done: Job) => {
    const clips = done.clips ?? [];
    update({
      clips,
      styled: {},
      styleErrors: {},
      sequence: clips.map((c) => ({ clipId: c.id, include: true, useStyled: true })),
      transitions: {},
      ...CLEAR_AFTER_STYLE,
    });
  });

  const min = Number(minSeconds);
  const max = Number(maxSeconds);
  const lengthError =
    !(min >= 1 && min <= 10) ? "The shortest clip must be 1 to 10 seconds" :
    !(max >= 2 && max <= 30) ? "The longest clip must be 2 to 30 seconds" :
    max < 2 * min ? "The longest clip must be at least twice the shortest" : null;
  const busy = isRunning(jobId, job, starting);

  async function handleSplit() {
    const styledCount = Object.keys(project.styled).length;
    if (styledCount && !window.confirm(`Split again? The ${styledCount} styled clips will be cleared.`)) return;
    setStarting(true);
    setStartError(null);
    setJobId(null);
    try {
      const { job_id } = await startSplit({
        source_id: project.source!.id,
        use_scenes: useScenes,
        threshold,
        min_seconds: min,
        max_seconds: max,
        rights_confirmed: project.rightsConfirmed,
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
      <div className="grid grid-cols-2 gap-2">
        {[
          { value: true, label: "At scene changes", hint: "Cut where the shot changes" },
          { value: false, label: "Equal parts", hint: "Ignore shots, use even lengths" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => setUseScenes(o.value)}
            className={`rounded-xl border px-3 py-2.5 text-left ${
              useScenes === o.value
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="block text-xs text-zinc-500">{o.hint}</span>
          </button>
        ))}
      </div>

      {useScenes && (
        <Slider
          label="Scene sensitivity"
          value={0.7 - threshold}
          min={0.1}
          max={0.6}
          step={0.05}
          onChange={(v) => setThreshold(Math.round((0.7 - v) * 100) / 100)}
          display={threshold >= 0.4 ? "Big changes only" : threshold <= 0.2 ? "Small changes too" : "Balanced"}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Shortest clip (seconds)">
          <input type="number" min={1} max={10} step={0.5} value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Longest clip (seconds)">
          <input type="number" min={2} max={30} step={1} value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Note>
        Short scenes join their neighbour and long ones are split evenly. Runway Aleph 2 accepts clips of 2 to 30 seconds, and
        Gemini Omni Flash up to 10 seconds. Clips are capped at 1080p and 30 fps, which both models need.
      </Note>
      {lengthError && <ErrorText>{lengthError}</ErrorText>}

      <button onClick={handleSplit} disabled={busy || !!lengthError} className={primaryButtonClass}>
        {busy ? "Splitting..." : project.clips.length ? "Split again" : "Split the video"}
      </button>
      <JobProgress jobId={jobId} job={job} starting={starting} startError={startError} />

      {project.clips.length > 0 && (
        <>
          <p className="text-xs text-zinc-500">
            {project.clips.length} clips · {formatDuration(project.clips.reduce((sum, c) => sum + c.duration, 0))} in total
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {project.clips.map((clip, i) => (
              <li key={clip.id}>
                <Thumb mediaId={clip.id} t={Math.min(0.5, clip.duration / 2)} label={`Clip ${i + 1}`} />
                <p className="mt-1 text-xs text-zinc-500">
                  {i + 1}. {formatDuration(clip.start)}–{formatDuration(clip.end)} · {clip.duration.toFixed(1)} s
                </p>
              </li>
            ))}
          </ul>
          <ContinueButton onClick={onNext}>Continue to AI styling</ContinueButton>
        </>
      )}
    </div>
  );
}
