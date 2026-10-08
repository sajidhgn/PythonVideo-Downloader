"use client";

import { useState } from "react";
import { uploadFile, type MediaInfo } from "@/lib/api";

type Props = {
  label: string;
  hint?: string;
  accept: string;
  onUploaded: (media: MediaInfo) => void;
  large?: boolean;
};

/** Click or drop a file to upload it to the backend. */
export default function FilePicker({ label, hint, accept, onUploaded, large }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      onUploaded(await uploadFile(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-center transition-colors ${
          large ? "px-6 py-14" : "px-4 py-5"
        } ${
          dragging
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
            : "border-zinc-300 hover:border-indigo-400 dark:border-zinc-700"
        }`}
      >
        <input
          type="file"
          accept={accept}
          className="sr-only"
          disabled={uploading}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <span className={`font-medium ${large ? "text-base" : "text-sm"}`}>{uploading ? "Uploading..." : label}</span>
        {hint && !uploading && <span className="text-xs text-zinc-500">{hint}</span>}
      </label>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
