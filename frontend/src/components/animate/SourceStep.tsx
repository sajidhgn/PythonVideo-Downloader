"use client";

import { useState } from "react";
import { ContinueButton, Note, type StepProps } from "@/components/animate/common";
import { newProject } from "@/components/animate/project";
import FilePicker from "@/components/FilePicker";
import { buttonClass, Checkbox, ErrorText, Field, inputClass } from "@/components/ui";
import { fileUrl, type MediaInfo } from "@/lib/api";
import { formatDuration } from "@/lib/format";

export default function SourceStep({ project, update, onNext }: StepProps) {
  const [error, setError] = useState<string | null>(null);
  const source = project.source;

  function choose(media: MediaInfo) {
    if (!media.has_video) {
      setError("Choose a video. Audio files can be added as music or narration in step 5.");
      return;
    }
    setError(null);
    update({ ...newProject(), source: { id: media.id, filename: media.filename, duration: media.duration } });
  }

  function chooseAnother() {
    if (project.clips.length && !window.confirm("Start over with a different video? Your clips and styled versions will be cleared.")) return;
    update(newProject());
  }

  return (
    <div className="flex flex-col gap-4">
      {source ? (
        <div>
          <video src={fileUrl(source.id, false)} controls preload="metadata" className="max-h-80 w-full rounded-xl bg-black" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-xs text-zinc-500">
              {source.title || source.filename} · {formatDuration(source.duration)}
            </p>
            <button type="button" onClick={chooseAnother} className={buttonClass}>
              Use a different video
            </button>
          </div>
        </div>
      ) : (
        <FilePicker
          large
          label="Drop a video here, or click to choose"
          hint="Or download one in the Download tab and press Animate."
          accept="video/*"
          onUploaded={choose}
        />
      )}
      {error && <ErrorText>{error}</ErrorText>}

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
        <Checkbox checked={project.rightsConfirmed} onChange={(v) => update({ rightsConfirmed: v })}>
          I own this footage, or I have a license or written permission to transform it and publish the result.
        </Checkbox>
        <Field label="Where the rights come from (optional, for your records)">
          <input
            value={project.rightsNote}
            onChange={(e) => update({ rightsNote: e.target.value })}
            placeholder="Filmed it myself / Licensed from a stock library, licence #1234"
            className={inputClass}
          />
        </Field>
        <Note>
          Downloading a video doesn&apos;t give you the right to restyle or republish it. Use other people&apos;s videos
          only with their permission.
        </Note>
      </div>

      {source && project.rightsConfirmed && <ContinueButton onClick={onNext}>Continue to splitting</ContinueButton>}
    </div>
  );
}
