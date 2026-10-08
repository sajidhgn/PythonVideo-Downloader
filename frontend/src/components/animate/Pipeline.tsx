"use client";

import { use, useEffect, useState } from "react";
import { browser } from "react-dom";
import AudioStep from "@/components/animate/AudioStep";
import CombineStep from "@/components/animate/CombineStep";
import type { StepProps } from "@/components/animate/common";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronIcon,
  ClapperboardIcon,
  MusicIcon,
  ScissorsIcon,
  VideoIcon,
  WandIcon,
  YouTubeIcon,
} from "@/components/animate/icons";
import { loadProject, newProject, saveProject, stepDone, type Project, type StepId } from "@/components/animate/project";
import PublishStep from "@/components/animate/PublishStep";
import SourceStep from "@/components/animate/SourceStep";
import SplitStep from "@/components/animate/SplitStep";
import StyleStep from "@/components/animate/StyleStep";
import { buttonClass, ErrorText } from "@/components/ui";
import { getAnimateOptions, getMedia, type AnimateOptions, type EditSource, type MediaInfo } from "@/lib/api";

const STEPS: { id: StepId; title: string; subtitle: string; Icon: () => React.ReactNode; Body: (props: StepProps) => React.ReactNode }[] = [
  { id: "source", title: "Original video", subtitle: "Use footage you own or are licensed to transform", Icon: VideoIcon, Body: SourceStep },
  { id: "split", title: "Split into clips", subtitle: "Break long videos into manageable scenes", Icon: ScissorsIcon, Body: SplitStep },
  { id: "style", title: "AI video transformation", subtitle: "Apply 3D cartoon, anime, or illustration styling", Icon: WandIcon, Body: StyleStep },
  { id: "combine", title: "Combine animated clips", subtitle: "Check character continuity, motion and scene transitions", Icon: ClapperboardIcon, Body: CombineStep },
  { id: "audio", title: "Original audio and editing", subtitle: "Use licensed music and narration", Icon: MusicIcon, Body: AudioStep },
  { id: "publish", title: "Publish to YouTube", subtitle: "Review rights, disclosures and monetization eligibility", Icon: YouTubeIcon, Body: PublishStep },
];

function firstUnfinished(project: Project): StepId {
  const done = stepDone(project);
  return STEPS.find((s) => !done[s.id])?.id ?? "publish";
}

function projectFor(media: MediaInfo, title?: string): Project {
  return { ...newProject(), source: { id: media.id, filename: media.filename, duration: media.duration, title } };
}

/** The six-step pipeline that turns owned or licensed footage into an animated YouTube video. */
export default function Pipeline({ incoming }: { incoming: EditSource | null }) {
  use(browser("The Animate project is saved in this browser's localStorage."));
  const [project, setProject] = useState<Project>(loadProject);
  const [open, setOpen] = useState<StepId | null>(() => firstUnfinished(project));
  const [options, setOptions] = useState<AnimateOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  // A video sent from the Download tab while another project is open.
  const [offer, setOffer] = useState<{ media: MediaInfo; title?: string } | null>(null);

  useEffect(() => saveProject(project), [project]);

  useEffect(() => {
    let cancelled = false;
    getAnimateOptions()
      .then((o) => !cancelled && setOptions(o))
      .catch((e: Error) => !cancelled && setOptionsError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!incoming) return;
    let cancelled = false;
    getMedia(incoming.id)
      .then((media) => {
        if (cancelled || !media.has_video) return;
        setProject((p) => (p.source ? p : projectFor(media, incoming.title)));
        setOffer({ media, title: incoming.title });
        setOpen("source");
      })
      .catch(() => {
        // The Download tab already showed the file; if it's gone, the user can upload instead.
      });
    return () => {
      cancelled = true;
    };
  }, [incoming]);

  function update(change: Partial<Project> | ((p: Project) => Partial<Project>)) {
    setProject((p) => ({ ...p, ...(typeof change === "function" ? change(p) : change) }));
  }

  function startOver() {
    if (!window.confirm("Start a new project? The current clips and settings will be cleared from this page.")) return;
    setProject(newProject());
    setOpen("source");
  }

  const done = stepDone(project);
  const showOffer = offer && project.source?.id !== offer.media.id;

  return (
    <div className="flex flex-col gap-4">
      {showOffer && (
        <div className="flex flex-col gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-3 text-sm sm:flex-row sm:items-center dark:border-indigo-900 dark:bg-indigo-950/40">
          <p className="flex-1">
            Start a new project with <span className="font-medium">{offer.title || offer.media.filename}</span>? This clears
            the current one.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setProject(projectFor(offer.media, offer.title));
                setOpen("source");
              }}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              Start new project
            </button>
            <button type="button" onClick={() => setOffer(null)} className={buttonClass}>
              Keep current
            </button>
          </div>
        </div>
      )}

      {optionsError && <ErrorText>{optionsError}</ErrorText>}

      <ol className="rounded-2xl border border-zinc-200 bg-zinc-50/60 px-2 py-3 shadow-sm sm:px-4 dark:border-zinc-800 dark:bg-zinc-900">
        {STEPS.map((step, i) => {
          const locked = i > 0 && !done[STEPS[i - 1].id];
          const isOpen = open === step.id && !locked && options !== null;
          return (
            <li key={step.id}>
              {i > 0 && (
                <div className="flex justify-end py-2 pr-[16%] text-zinc-400" aria-hidden="true">
                  <ArrowDownIcon />
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : step.id)}
                disabled={locked}
                aria-expanded={isOpen}
                className="flex w-full items-start gap-4 rounded-xl px-2 py-2 text-left enabled:hover:bg-white disabled:cursor-not-allowed dark:enabled:hover:bg-zinc-800/60"
              >
                <span className={`mt-1.5 shrink-0 ${locked ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-900 dark:text-zinc-100"}`}>
                  <step.Icon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xl font-medium ${locked ? "text-zinc-400 dark:text-zinc-500" : ""}`}>{step.title}</span>
                  <span className="mt-1 block text-sm text-zinc-500">{step.subtitle}</span>
                </span>
                <span className="mt-2 flex shrink-0 items-center gap-2 text-zinc-400">
                  {done[step.id] && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      <CheckIcon /> Done
                    </span>
                  )}
                  {locked ? <span className="text-xs">Locked</span> : <ChevronIcon open={isOpen} />}
                </span>
              </button>
              {isOpen && (
                <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                  <step.Body project={project} update={update} options={options} onNext={() => setOpen(STEPS[i + 1]?.id ?? null)} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex justify-end">
        <button type="button" onClick={startOver} className={buttonClass}>
          Start a new project
        </button>
      </div>
    </div>
  );
}
