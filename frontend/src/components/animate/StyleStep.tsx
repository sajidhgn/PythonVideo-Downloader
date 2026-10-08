"use client";

import { useState } from "react";
import { CLEAR_AFTER_STYLE, ContinueButton, isRunning, JobProgress, Note, Thumb, type StepProps } from "@/components/animate/common";
import { randomSeed } from "@/components/animate/project";
import { buttonClass, ErrorText, Field, inputClass, primaryButtonClass } from "@/components/ui";
import { fileUrl, frameUrl, startStylize, type ClipInfo, type Job, type StyleProvider } from "@/lib/api";
import { useJob } from "@/lib/useJob";

/** Runway charges $0.01 per credit. */
const DOLLARS_PER_CREDIT = 0.01;

function estimateCredits(provider: StyleProvider, clips: ClipInfo[]) {
  return clips.reduce((sum, c) => sum + Math.max(provider.min_credits, Math.ceil(provider.credits_per_second * c.duration)), 0);
}

function lengthProblem(provider: StyleProvider, clip: ClipInfo): string | null {
  if (clip.duration < provider.min_seconds - 0.05) return `is shorter than ${provider.min_seconds} s`;
  if (provider.max_seconds && clip.duration > provider.max_seconds + 0.05) return `is longer than ${provider.max_seconds} s`;
  return null;
}

export default function StyleStep({ project, update, options, onNext }: StepProps) {
  const [style, setStyle] = useState(options.styles[0]?.id ?? "3d_cartoon");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [providerId, setProviderId] = useState(
    () => options.providers.find((p) => p.available && p.credits_per_second > 0)?.id ?? "preview",
  );
  // Start with the clips that don't have a styled version yet, or all of them.
  const [selected, setSelected] = useState<string[]>(() => {
    const unstyled = project.clips.filter((c) => !project.styled[c.id]).map((c) => c.id);
    return unstyled.length ? unstyled : project.clips.map((c) => c.id);
  });
  const [jobId, setJobId] = useState<string | null>(null);
  // The style the running job uses, in case the choice changes before it ends.
  const [jobStyle, setJobStyle] = useState(style);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const job = useJob(jobId, (done: Job) => {
    const styleLabel = options.styles.find((s) => s.id === jobStyle)?.label ?? jobStyle;
    update((p) => {
      const styled = { ...p.styled };
      const styleErrors = { ...p.styleErrors };
      for (const out of done.outputs ?? []) {
        if (out.id && out.filename) {
          styled[out.source_id] = { id: out.id, filename: out.filename, style: styleLabel };
          delete styleErrors[out.source_id];
        } else if (out.error) {
          styleErrors[out.source_id] = out.error;
        }
      }
      return { styled, styleErrors, ...CLEAR_AFTER_STYLE };
    });
  });

  const provider = options.providers.find((p) => p.id === providerId) ?? options.providers[0];
  const chosen = project.clips.filter((c) => selected.includes(c.id));
  const problems = chosen
    .map((c) => ({ clip: c, problem: lengthProblem(provider, c) }))
    .filter((x) => x.problem);
  const credits = estimateCredits(provider, chosen);
  const busy = isRunning(jobId, job, starting);
  const styledCount = Object.keys(project.styled).length;

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function handleStyle() {
    if (credits > 0 && !window.confirm(`This uses about ${credits.toLocaleString()} Runway credits (about $${(credits * DOLLARS_PER_CREDIT).toFixed(2)}). Continue?`)) {
      return;
    }
    setStarting(true);
    setStartError(null);
    setJobId(null);
    try {
      const { job_id } = await startStylize({
        clip_ids: chosen.map((c) => c.id),
        provider: provider.id,
        style,
        extra_prompt: extraPrompt,
        seed: project.seed,
        rights_confirmed: project.rightsConfirmed,
      });
      setJobStyle(style);
      setJobId(job_id);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Style">
        {options.styles.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={style === s.id}
            onClick={() => setStyle(s.id)}
            className={`rounded-xl border px-3 py-3 text-sm font-medium ${
              style === s.id
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Field label="Extra style notes (optional)" hint="Describe looks that must stay the same in every clip, such as a character's outfit.">
        <textarea
          value={extraPrompt}
          onChange={(e) => setExtraPrompt(e.target.value)}
          maxLength={500}
          rows={2}
          dir="auto"
          placeholder="Warm sunset colors. The girl always wears a yellow raincoat."
          className={inputClass}
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs text-zinc-500">Model</legend>
        {options.providers.map((p) => (
          <label
            key={p.id}
            className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
              p.available ? "cursor-pointer" : "opacity-60"
            } ${providerId === p.id ? "border-indigo-500" : "border-zinc-200 dark:border-zinc-700"}`}
          >
            <input
              type="radio"
              name="provider"
              checked={providerId === p.id}
              disabled={!p.available}
              onChange={() => setProviderId(p.id)}
              className="mt-1 accent-indigo-600"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium">{p.label}</span>
              <span className="block text-xs text-zinc-500">
                {p.available ? p.note : "Needs RUNWAYML_API_SECRET on the backend."}
              </span>
            </span>
            <span className="shrink-0 text-xs text-zinc-500">
              {p.credits_per_second ? `${p.credits_per_second} credits/s` : "Free"}
            </span>
          </label>
        ))}
      </fieldset>

      {provider.supports_seed && (
        <Field label="Seed" hint="Every clip uses the same seed, which helps keep characters and colors consistent.">
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              max={4294967295}
              value={project.seed}
              onChange={(e) => update({ seed: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              className={inputClass}
            />
            <button type="button" onClick={() => update({ seed: randomSeed() })} className={`${buttonClass} shrink-0`}>
              New seed
            </button>
          </div>
        </Field>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            {chosen.length} of {project.clips.length} clips selected
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSelected(project.clips.map((c) => c.id))} className={buttonClass}>
              All
            </button>
            <button type="button" onClick={() => setSelected([])} className={buttonClass}>
              None
            </button>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {project.clips.map((clip, i) => {
            const styled = project.styled[clip.id];
            const error = project.styleErrors[clip.id];
            return (
              <li key={clip.id} className="flex flex-col gap-1">
                {styled ? (
                  <video
                    src={fileUrl(styled.id, false)}
                    poster={frameUrl(styled.id, Math.min(0.5, clip.duration / 2))}
                    controls
                    preload="none"
                    className="aspect-video w-full rounded-lg bg-black object-cover"
                  />
                ) : (
                  <Thumb mediaId={clip.id} t={Math.min(0.5, clip.duration / 2)} label={`Clip ${i + 1}`} />
                )}
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" checked={selected.includes(clip.id)} onChange={() => toggle(clip.id)} className="accent-indigo-600" />
                  <span className="truncate">
                    Clip {i + 1} · {clip.duration.toFixed(1)} s
                    {styled && <span className="text-emerald-600 dark:text-emerald-400"> · {styled.style}</span>}
                  </span>
                </label>
                {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      {problems.length > 0 && (
        <ErrorText>
          {problems.map(({ clip, problem }) => `Clip ${project.clips.indexOf(clip) + 1} ${problem}`).join(". ")}. {provider.label} can&apos;t
          take {problems.length === 1 ? "it" : "them"}. Deselect {problems.length === 1 ? "it" : "them"}, choose another model, or split again.
        </ErrorText>
      )}

      {credits > 0 && (
        <Note>
          Estimated cost: about {credits.toLocaleString()} credits (${(credits * DOLLARS_PER_CREDIT).toFixed(2)}) for{" "}
          {chosen.reduce((s, c) => s + c.duration, 0).toFixed(1)} s of video. Runway bills the final amount.
        </Note>
      )}
      {provider.id === "preview" && (
        <Note>The offline preview is a cartoon filter, not AI. Use it to try the rest of the steps before paying for a real style.</Note>
      )}

      <button onClick={handleStyle} disabled={busy || !chosen.length || problems.length > 0} className={primaryButtonClass}>
        {busy ? "Styling..." : `Style ${chosen.length} clip${chosen.length === 1 ? "" : "s"}`}
      </button>
      <JobProgress jobId={jobId} job={job} starting={starting} startError={startError} />
      {job?.status === "done" && !!job.credits && <p className="text-xs text-zinc-500">Runway charged {job.credits} credits.</p>}

      {styledCount > 0 && (
        <ContinueButton onClick={onNext}>
          Continue to combining ({styledCount} of {project.clips.length} clips styled)
        </ContinueButton>
      )}
    </div>
  );
}
