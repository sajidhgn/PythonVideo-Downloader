"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { getProgress, type Job } from "@/lib/api";

/** Polls a job until it finishes. Returns null until the first update.
 * onDone runs once when the job succeeds, for saving its results. */
export function useJob(jobId: string | null, onDone?: (job: Job) => void): Job | null {
  const [state, setState] = useState<{ id: string; job: Job } | null>(null);
  const handleDone = useEffectEvent((job: Job) => onDone?.(job));

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const job = await getProgress(jobId);
        if (stopped) return;
        setState({ id: jobId, job });
        if (job.status === "done" || job.status === "error") {
          clearInterval(timer);
          stopped = true;
          if (job.status === "done") handleDone(job);
        }
      } catch (e) {
        clearInterval(timer);
        if (!stopped) {
          setState({ id: jobId, job: { status: "error", progress: 0, speed: "", eta: "", error: (e as Error).message } });
        }
      }
    }, 600);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId]);

  // Ignore results from a previous job while the new one starts.
  return state && state.id === jobId ? state.job : null;
}
