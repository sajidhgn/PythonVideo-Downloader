"use client";

import { useEffect, useState } from "react";
import { getProgress, type Job } from "@/lib/api";

/** Polls a download or edit job until it finishes. Returns null until the first update. */
export function useJob(jobId: string | null): Job | null {
  const [state, setState] = useState<{ id: string; job: Job } | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const job = await getProgress(jobId);
        if (stopped) return;
        setState({ id: jobId, job });
        if (job.status === "done" || job.status === "error") clearInterval(timer);
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
