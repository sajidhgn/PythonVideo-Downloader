import type { ClipInfo, TransitionKind } from "@/lib/api";

/** A file the backend made or received, by media id. */
export type MediaRef = { id: string; filename: string };

export type Transition = { kind: TransitionKind; duration: number; reviewed: boolean };

/** Everything the Animate pipeline has produced so far. Saved in the browser so a
 * reload keeps the work; the files themselves live on the backend. */
export type Project = {
  source: (MediaRef & { duration: number; title?: string }) | null;
  rightsConfirmed: boolean;
  rightsNote: string;
  clips: ClipInfo[];
  /** The latest styled version of each clip, by the original clip's id. */
  styled: Record<string, MediaRef & { style: string }>;
  styleErrors: Record<string, string>;
  /** Clip order for the combined film, and whether each clip is used. */
  sequence: { clipId: string; include: boolean; useStyled: boolean }[];
  /** Transition and continuity check for each join, keyed by `${fromId}>${toId}`. */
  transitions: Record<string, Transition>;
  /** The same seed for every clip keeps characters and colors consistent. */
  seed: number;
  combined: MediaRef | null;
  final: MediaRef | null;
  published: { videoId: string; url: string; studioUrl: string } | null;
};

const STORAGE_KEY = "animate-project-v1";

export const DEFAULT_TRANSITION: Transition = { kind: "cut", duration: 0.5, reviewed: false };

export function randomSeed() {
  return Math.floor(Math.random() * 1_000_000_000);
}

export function newProject(): Project {
  return {
    source: null,
    rightsConfirmed: false,
    rightsNote: "",
    clips: [],
    styled: {},
    styleErrors: {},
    sequence: [],
    transitions: {},
    seed: randomSeed(),
    combined: null,
    final: null,
    published: null,
  };
}

export function loadProject(): Project {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...newProject(), ...JSON.parse(saved) };
  } catch {
    // Storage blocked or the saved project is unreadable: start fresh.
  }
  return newProject();
}

export function saveProject(project: Project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // Private mode or full storage: the project still works until the page closes.
  }
}

export const joinKey = (fromId: string, toId: string) => `${fromId}>${toId}`;

/** The clips going into the combined film, in order. */
export function includedSequence(project: Project) {
  return project.sequence.filter((s) => s.include);
}

export type StepId = "source" | "split" | "style" | "combine" | "audio" | "publish";

/** Whether each step is finished. A step can start once the one before it is. */
export function stepDone(project: Project): Record<StepId, boolean> {
  return {
    source: project.source !== null && project.rightsConfirmed,
    split: project.clips.length > 0,
    style: Object.keys(project.styled).length > 0,
    combine: project.combined !== null,
    audio: project.final !== null,
    publish: project.published !== null,
  };
}
