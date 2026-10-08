"use client";

import { useState } from "react";
import { ContinueButton, isRunning, JobProgress, Note, stem, Thumb, type StepProps } from "@/components/animate/common";
import { DEFAULT_TRANSITION, joinKey, type Project, type Transition } from "@/components/animate/project";
import { buttonClass, Checkbox, Field, inputClass, primaryButtonClass, saveLinkClass, Slider } from "@/components/ui";
import { fileUrl, startCombine, type Job, type TransitionKind } from "@/lib/api";
import { useJob } from "@/lib/useJob";

const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: "cut", label: "Cut" },
  { kind: "crossfade", label: "Crossfade" },
  { kind: "fadeblack", label: "Fade through black" },
];

type SequenceItem = Project["sequence"][number];

export default function CombineStep({ project, update, onNext }: StepProps) {
  const [withAudio, setWithAudio] = useState(true);
  const [filename, setFilename] = useState(() => `${stem(project.source?.filename ?? "video")} - animated`);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const job = useJob(jobId, (done: Job) => {
    if (jobId) update({ combined: { id: jobId, filename: done.filename ?? "combined.mp4" }, final: null, published: null });
  });

  const clipNumber = (clipId: string) => project.clips.findIndex((c) => c.id === clipId) + 1;
  const clipOf = (clipId: string) => project.clips.find((c) => c.id === clipId);
  const videoFor = (item: SequenceItem) => (item.useStyled && project.styled[item.clipId]?.id) || item.clipId;

  const included = project.sequence.filter((s) => s.include);
  const joins = included.slice(1).map((item, i) => joinKey(included[i].clipId, item.clipId));
  const transitionFor = (key: string): Transition => project.transitions[key] ?? DEFAULT_TRANSITION;
  const reviewed = joins.filter((k) => transitionFor(k).reviewed).length;
  const unstyled = included.filter((s) => !(s.useStyled && project.styled[s.clipId]));
  const busy = isRunning(jobId, job, starting);

  function setItem(index: number, change: Partial<SequenceItem>) {
    update((p) => ({ sequence: p.sequence.map((s, i) => (i === index ? { ...s, ...change } : s)), combined: null, final: null, published: null }));
  }

  function move(index: number, by: number) {
    update((p) => {
      const sequence = [...p.sequence];
      const target = index + by;
      if (target < 0 || target >= sequence.length) return {};
      [sequence[index], sequence[target]] = [sequence[target], sequence[index]];
      return { sequence, combined: null, final: null, published: null };
    });
  }

  function setTransition(key: string, change: Partial<Transition>) {
    update((p) => ({ transitions: { ...p.transitions, [key]: { ...(p.transitions[key] ?? DEFAULT_TRANSITION), ...change } } }));
  }

  async function handleCombine() {
    setStarting(true);
    setStartError(null);
    setJobId(null);
    try {
      const { job_id } = await startCombine({
        // The sound comes from the clip before styling, which still has it.
        parts: included.map((s) => ({ video_id: videoFor(s), audio_id: s.clipId })),
        transitions: joins.map((k) => ({ kind: transitionFor(k).kind, duration: transitionFor(k).duration })),
        with_audio: withAudio,
        filename,
      });
      setJobId(job_id);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  // For each row, the included clip that plays just before it (where its join starts).
  const playsBefore: (string | null)[] = [];
  let last: string | null = null;
  for (const item of project.sequence) {
    playsBefore.push(item.include ? last : null);
    if (item.include) last = item.clipId;
  }

  return (
    <div className="flex flex-col gap-4">
      <Note>
        Compare the end of each clip with the start of the next. If a character&apos;s face, outfit or colors change, restyle
        that clip in step 3 with the same seed and style notes, use the original footage for it, or soften the join with a
        crossfade.
      </Note>

      <ol className="flex flex-col gap-2">
        {project.sequence.map((item, index) => {
          const clip = clipOf(item.clipId);
          const styled = project.styled[item.clipId];
          const fromClip = playsBefore[index];
          const join = fromClip ? joinKey(fromClip, item.clipId) : null;
          return (
            <li key={item.clipId} className="flex flex-col gap-2">
              {join && fromClip && (
                <JoinReview
                  fromVideo={videoFor(project.sequence.find((s) => s.clipId === fromClip)!)}
                  toVideo={videoFor(item)}
                  label={`Clip ${clipNumber(fromClip)} → clip ${clipNumber(item.clipId)}`}
                  transition={transitionFor(join)}
                  onChange={(change) => setTransition(join, change)}
                />
              )}
              <div
                className={`flex items-center gap-3 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700 ${
                  item.include ? "" : "opacity-50"
                }`}
              >
                <div className="w-28 shrink-0">
                  <Thumb mediaId={videoFor(item)} t={Math.min(0.5, (clip?.duration ?? 1) / 2)} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Clip {clipNumber(item.clipId)}
                    <span className="font-normal text-zinc-500"> · {clip?.duration.toFixed(1)} s</span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={item.include} onChange={(e) => setItem(index, { include: e.target.checked })} className="accent-indigo-600" />
                      Use
                    </label>
                    <select
                      value={styled && item.useStyled ? "styled" : "original"}
                      onChange={(e) => setItem(index, { useStyled: e.target.value === "styled" })}
                      className="rounded-md border border-zinc-200 bg-transparent px-1.5 py-1 dark:border-zinc-700"
                      aria-label="Version"
                    >
                      <option value="styled" disabled={!styled}>
                        {styled ? styled.style : "Not styled yet"}
                      </option>
                      <option value="original">Original footage</option>
                    </select>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className={buttonClass} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === project.sequence.length - 1}
                    className={buttonClass}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {joins.length > 0 && (
        <p className={`text-xs ${reviewed === joins.length ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {reviewed} of {joins.length} joins checked for continuity
        </p>
      )}
      {unstyled.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {unstyled.length === 1 ? "Clip" : "Clips"} {unstyled.map((s) => clipNumber(s.clipId)).join(", ")} will use the original footage.
        </p>
      )}

      <Checkbox checked={withAudio} onChange={setWithAudio}>
        Keep each clip&apos;s original sound (you can mute or replace it in the next step)
      </Checkbox>
      <Field label="File name">
        <div className="flex items-center gap-2">
          <input value={filename} onChange={(e) => setFilename(e.target.value)} className={inputClass} />
          <span className="text-sm text-zinc-500">.mp4</span>
        </div>
      </Field>

      <button onClick={handleCombine} disabled={busy || !included.length} className={primaryButtonClass}>
        {busy ? "Combining..." : `Combine ${included.length} clip${included.length === 1 ? "" : "s"}`}
      </button>
      <JobProgress jobId={jobId} job={job} starting={starting} startError={startError} />

      {project.combined && (
        <div className="flex flex-col gap-3">
          <video src={fileUrl(project.combined.id, false)} controls preload="metadata" className="max-h-80 w-full rounded-xl bg-black" />
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={fileUrl(project.combined.id)} className={saveLinkClass}>
              Save {project.combined.filename}
            </a>
          </div>
          <ContinueButton onClick={onNext}>Continue to audio</ContinueButton>
        </div>
      )}
    </div>
  );
}

function JoinReview({ fromVideo, toVideo, label, transition, onChange }: {
  fromVideo: string;
  toVideo: string;
  label: string;
  transition: Transition;
  onChange: (change: Partial<Transition>) => void;
}) {
  return (
    <div className="ml-6 flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <figure>
          <Thumb mediaId={fromVideo} fromEnd label="Last frame" />
          <figcaption className="mt-0.5 text-[11px] text-zinc-400">Ends</figcaption>
        </figure>
        <span className="text-zinc-400">→</span>
        <figure>
          <Thumb mediaId={toVideo} label="First frame" />
          <figcaption className="mt-0.5 text-[11px] text-zinc-400">Starts</figcaption>
        </figure>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TRANSITIONS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => onChange({ kind: t.kind })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              transition.kind === t.kind
                ? "bg-indigo-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {transition.kind !== "cut" && (
        <Slider
          label="Transition length"
          value={transition.duration}
          min={0.2}
          max={2}
          step={0.1}
          onChange={(v) => onChange({ duration: v })}
          display={`${transition.duration.toFixed(1)} s`}
        />
      )}
      <Checkbox checked={transition.reviewed} onChange={(v) => onChange({ reviewed: v })}>
        <span className="text-xs">Characters, motion and colors match across this join</span>
      </Checkbox>
    </div>
  );
}

