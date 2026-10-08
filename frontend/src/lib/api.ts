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
