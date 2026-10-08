"use client";

import type { Project } from "@/components/animate/project";
import { ErrorText, ProgressBar } from "@/components/ui";
import { frameUrl, type AnimateOptions, type Job } from "@/lib/api";

export type StepProps = {
  project: Project;
  /** Merge changes into the project. */
  update: (change: Partial<Project> | ((p: Project) => Partial<Project>)) => void;
  options: AnimateOptions;
  /** Open the next step. */
  onNext: () => void;
};

/** Changes that clear everything a step's output feeds into. */
export const CLEAR_AFTER_STYLE = { combined: null, final: null, published: null } satisfies Partial<Project>;

export function isRunning(jobId: string | null, job: Job | null, starting: boolean) {
  return starting || (jobId !== null && job?.status !== "done" && job?.status !== "error");
}

/** "my video - clip 03.mp4" -> "my video - clip 03". */
export const stem = (filename: string) => filename.replace(/\.[^.]+$/, "");

export function Thumb({ mediaId, t = 0, fromEnd = false, label }: { mediaId: string; t?: number; fromEnd?: boolean; label?: string }) {
  return (
    // Frames come straight from the backend, so a plain <img> is simpler than next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={frameUrl(mediaId, t, fromEnd)}
      alt={label ?? ""}
      loading="lazy"
      className="aspect-video w-full rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800"
    />
  );
}

/** Progress while a job runs, and its error if it fails. */
export function JobProgress({ jobId, job, starting, startError }: { jobId: string | null; job: Job | null; starting: boolean; startError: string | null }) {
  if (startError) return <ErrorText>{startError}</ErrorText>;
  if (job?.status === "error") return <ErrorText>{job.error}</ErrorText>;
  if (!isRunning(jobId, job, starting)) return null;
  const label = !job ? "Starting..." : [job.stage, `${job.progress}%`].filter(Boolean).join(" · ");
  return <ProgressBar progress={job?.progress ?? 0} label={label} />;
}

export function ContinueButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-950"
    >
      {children}
    </button>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
      {children}
    </p>
  );
}
