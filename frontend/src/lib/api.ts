export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type VideoInfo = {
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  platform: string | null;
  heights: number[];
  ffmpeg: boolean;
};

export type Job = {
  status: "downloading" | "processing" | "done" | "error";
  progress: number;
  speed: string;
  eta: string;
  filename?: string;
  error?: string;
  /** What a multi-step job is doing now, e.g. "Clip 2 of 5: Generating". */
  stage?: string;
  /** Split results. */
  clips?: ClipInfo[];
  /** Styling results, one per clip, in order. */
  outputs?: StyleOutput[];
  /** Runway credits a styling job used. */
  credits?: number;
  /** YouTube upload results. */
  video_id?: string;
  url?: string;
  studio_url?: string;
};

/** The details the editor writes into the file. */
export type MediaDetails = {
  title: string;
  alt_text: string;
  tags: string;
  author: string;
};

export type MediaInfo = {
  id: string;
  filename: string;
  duration: number;
  has_video: boolean;
  has_audio: boolean;
  details: MediaDetails;
};

/** A file to open in the editor: a finished download, upload or earlier edit. */
export type EditSource = { id: string; title?: string };

export type EditRequest = MediaDetails & {
  source_id: string;
  trim_start: number;
  trim_end: number | null;
  speed: number;
  original_volume: number;
  music_id: string | null;
  music_volume: number;
  filename: string;
};

function errorMessage(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  // FastAPI validation errors are a list of {msg, loc}.
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? String(d)).join(", ");
  return `Request failed (${status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error(`Can't reach the backend at ${API_URL}. Is it running?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorMessage(data.detail, res.status));
  return data as T;
}

function postJson<T>(path: string, body: unknown) {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const getInfo = (url: string) => postJson<VideoInfo>("/api/info", { url });

export const startDownload = (url: string, quality: string) =>
  postJson<{ job_id: string }>("/api/download", { url, quality });

export const getProgress = (jobId: string) => request<Job>(`/api/progress/${jobId}`);

export function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<MediaInfo>("/api/uploads", { method: "POST", body: form });
}

export const getMedia = (id: string) => request<MediaInfo>(`/api/media/${id}`);

export const startEdit = (req: EditRequest) => postJson<{ job_id: string }>("/api/edit", req);

/** download=false serves the file inline so <video> can preview it. */
export const fileUrl = (jobId: string, download = true) =>
  `${API_URL}/api/file/${jobId}${download ? "" : "?download=false"}`;

/** A JPEG of one frame. fromEnd counts t back from the end of the clip. */
export const frameUrl = (mediaId: string, t = 0, fromEnd = false) =>
  `${API_URL}/api/media/${mediaId}/frame?t=${t}${fromEnd ? "&from_end=true" : ""}`;

// Animate pipeline

export type ClipInfo = { id: string; filename: string; start: number; end: number; duration: number };

export type StyleOutput = { source_id: string; id?: string; filename?: string; error?: string };

export type StyleProvider = {
  id: string;
  label: string;
  note: string;
  credits_per_second: number;
  min_credits: number;
  min_seconds: number;
  max_seconds: number | null;
  supports_seed: boolean;
  available: boolean;
};

export type YouTubeStatus = { configured: boolean; connected: boolean };

export type AnimateOptions = {
  styles: { id: string; label: string }[];
  providers: StyleProvider[];
  youtube: YouTubeStatus & { categories: Record<string, string> };
};

export type TransitionKind = "cut" | "crossfade" | "fadeblack";

export type SplitRequest = {
  source_id: string;
  use_scenes: boolean;
  threshold: number;
  min_seconds: number;
  max_seconds: number;
  rights_confirmed: boolean;
};

export type StylizeRequest = {
  clip_ids: string[];
  provider: string;
  style: string;
  extra_prompt: string;
  seed: number;
  rights_confirmed: boolean;
};

export type CombineRequest = {
  parts: { video_id: string; audio_id: string | null }[];
  transitions: { kind: TransitionKind; duration: number }[];
  with_audio: boolean;
  filename: string;
};

export type SoundtrackRequest = {
  video_id: string;
  original_volume: number;
  narration_id: string | null;
  narration_volume: number;
  narration_start: number;
  music_id: string | null;
  music_volume: number;
  duck_music: boolean;
  normalize: boolean;
  audio_rights_confirmed: boolean;
  filename: string;
};

export type PublishRequest = {
  video_id: string;
  title: string;
  description: string;
  tags: string[];
  category_id: string;
  privacy: "private" | "unlisted" | "public";
  made_for_kids: boolean;
  contains_synthetic_media: boolean;
  footage_rights: boolean;
  audio_rights: boolean;
  original_value: boolean;
  guidelines: boolean;
};

type JobStart = { job_id: string };

export const getAnimateOptions = () => request<AnimateOptions>("/api/animate/options");
export const startSplit = (req: SplitRequest) => postJson<JobStart>("/api/animate/split", req);
export const startStylize = (req: StylizeRequest) => postJson<JobStart>("/api/animate/stylize", req);
export const startCombine = (req: CombineRequest) => postJson<JobStart>("/api/animate/combine", req);
export const startSoundtrack = (req: SoundtrackRequest) => postJson<JobStart>("/api/animate/soundtrack", req);

export const getYouTubeStatus = () => request<YouTubeStatus>("/api/youtube/status");
export const disconnectYouTube = () => postJson<YouTubeStatus>("/api/youtube/disconnect", {});
export const startPublish = (req: PublishRequest) => postJson<JobStart>("/api/youtube/publish", req);
/** Opened in a new tab: the backend sends it on to Google's consent screen. */
export const youTubeConnectUrl = `${API_URL}/api/youtube/connect`;
