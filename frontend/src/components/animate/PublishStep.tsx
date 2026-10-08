"use client";

import { useEffect, useState } from "react";
import { isRunning, JobProgress, Note, stem, type StepProps } from "@/components/animate/common";
import { buttonClass, Checkbox, ErrorText, Field, inputClass, primaryButtonClass, saveLinkClass } from "@/components/ui";
import {
  disconnectYouTube,
  fileUrl,
  getYouTubeStatus,
  startPublish,
  youTubeConnectUrl,
  type Job,
  type PublishRequest,
  type YouTubeStatus,
} from "@/lib/api";
import { useJob } from "@/lib/useJob";

const PRIVACY: { value: PublishRequest["privacy"]; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

const CHECKLIST = [
  {
    key: "footage_rights",
    text: "I own the original footage, or my license lets me transform it and publish it on YouTube with ads.",
  },
  {
    key: "audio_rights",
    text: "I made the music and narration, or my licenses cover monetized YouTube videos.",
  },
  {
    key: "original_value",
    text: "The video adds my own creative work, such as story, narration or editing. It isn't just a restyled copy of someone else's video, which YouTube treats as reused content and may not monetize.",
  },
  {
    key: "guidelines",
    text: "I watched the whole final video, and it follows YouTube's Community Guidelines and advertiser-friendly content guidelines.",
  },
] as const;

type ChecklistKey = (typeof CHECKLIST)[number]["key"];

export default function PublishStep({ project, update, options }: StepProps) {
  const final = project.final!;
  const [status, setStatus] = useState<YouTubeStatus>(options.youtube);
  const [waitingForSignIn, setWaitingForSignIn] = useState(false);

  // While the Google sign-in tab is open, check every few seconds whether it finished.
  useEffect(() => {
    if (!waitingForSignIn) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const next = await getYouTubeStatus();
        setStatus(next);
        if (next.connected || Date.now() - started > 5 * 60_000) {
          clearInterval(timer);
          setWaitingForSignIn(false);
        }
      } catch {
        // Try again on the next tick.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [waitingForSignIn]);

  return (
    <div className="flex flex-col gap-4">
      <a href={fileUrl(final.id)} className={saveLinkClass}>
        Save {final.filename}
      </a>

      {project.published ? (
        <Published published={project.published} />
      ) : !status.configured ? (
        <SetupHelp />
      ) : !status.connected ? (
        <div className="flex flex-col gap-2">
          <a
            href={youTubeConnectUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setWaitingForSignIn(true)}
            className={`${primaryButtonClass} text-center`}
          >
            Connect a YouTube account
          </a>
          <p className="text-xs text-zinc-500">
            {waitingForSignIn
              ? "Waiting for you to finish signing in to Google in the new tab..."
              : "Opens Google's sign-in in a new tab. The app only asks for permission to upload videos."}
          </p>
        </div>
      ) : (
        <PublishForm
          project={project}
          onPublished={(published) => update({ published })}
          onDisconnect={async () => setStatus(await disconnectYouTube())}
          categories={options.youtube.categories}
        />
      )}
    </div>
  );
}

function PublishForm({ project, categories, onPublished, onDisconnect }: {
  project: StepProps["project"];
  categories: Record<string, string>;
  onPublished: (published: NonNullable<StepProps["project"]["published"]>) => void;
  onDisconnect: () => void;
}) {
  const final = project.final!;
  const [title, setTitle] = useState(() => (project.source?.title || stem(final.filename)).slice(0, 100));
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("animation");
  const [categoryId, setCategoryId] = useState("1");
  const [privacy, setPrivacy] = useState<PublishRequest["privacy"]>("private");
  const [madeForKids, setMadeForKids] = useState<boolean | null>(null);
  const [synthetic, setSynthetic] = useState(true);
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>({
    footage_rights: false,
    audio_rights: false,
    original_value: false,
    guidelines: false,
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const job = useJob(jobId, (done: Job) => {
    if (done.video_id && done.url && done.studio_url) {
      onPublished({ videoId: done.video_id, url: done.url, studioUrl: done.studio_url });
    }
  });

  const titleError = !title.trim() ? "Add a title" : /[<>]/.test(title + description) ? "YouTube doesn't allow < or >" : null;
  const allChecked = CHECKLIST.every((c) => checks[c.key]);
  const busy = isRunning(jobId, job, starting);
  const ready = !busy && !titleError && madeForKids !== null && allChecked;

  async function handlePublish() {
    if (madeForKids === null) return;
    setStarting(true);
    setStartError(null);
    setJobId(null);
    try {
      const { job_id } = await startPublish({
        video_id: final.id,
        title: title.trim(),
        description,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        category_id: categoryId,
        privacy,
        made_for_kids: madeForKids,
        contains_synthetic_media: synthetic,
        ...checks,
      });
      setJobId(job_id);
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>YouTube account connected</span>
        <button type="button" onClick={onDisconnect} className={buttonClass}>
          Disconnect
        </button>
      </div>

      <Field label={`Title (${title.length}/100)`}>
        <input value={title} maxLength={100} dir="auto" onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Description" hint="Credit any music or footage whose license asks for it.">
        <textarea value={description} maxLength={5000} rows={4} dir="auto" onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tags" hint="Separate with commas.">
          <input value={tags} dir="auto" onChange={(e) => setTags(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Category">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
            {Object.entries(categories).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-xs text-zinc-500">Visibility</legend>
        <div className="flex gap-2">
          {PRIVACY.map((p) => (
            <label key={p.value} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="privacy" checked={privacy === p.value} onChange={() => setPrivacy(p.value)} className="accent-indigo-600" />
              {p.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          Start private, check the video in YouTube Studio, then make it public there.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
        <legend className="px-1 text-xs font-medium">Disclosures</legend>
        <p className="text-sm">Is this video made for kids?</p>
        <div className="flex gap-4">
          {[
            { value: true, label: "Yes, it's made for kids" },
            { value: false, label: "No, it's not made for kids" },
          ].map((o) => (
            <label key={o.label} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="kids" checked={madeForKids === o.value} onChange={() => setMadeForKids(o.value)} className="accent-indigo-600" />
              {o.label}
            </label>
          ))}
        </div>
        <Note>
          YouTube requires this answer by law (COPPA). A cartoon look doesn&apos;t make a video &quot;made for kids&quot; on its
          own: answer for the audience you made it for.
        </Note>
        <Checkbox checked={synthetic} onChange={setSynthetic}>
          Altered or synthetic content: label this video as made with AI
        </Checkbox>
        <Note>
          YouTube asks you to label realistic content made or changed with AI that viewers could mistake for real people,
          places or events. Clearly animated content usually doesn&apos;t need the label. If you&apos;re not sure, leave it on.
        </Note>
      </fieldset>

      <fieldset className="flex flex-col gap-2.5 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
        <legend className="px-1 text-xs font-medium">Rights and monetization</legend>
        {CHECKLIST.map((c) => (
          <Checkbox key={c.key} checked={checks[c.key]} onChange={(v) => setChecks((s) => ({ ...s, [c.key]: v }))}>
            {c.text}
          </Checkbox>
        ))}
        <Note>
          YouTube decides monetization when it reviews your channel for the YouTube Partner Program, and again for each
          video. This checklist can&apos;t guarantee it.
        </Note>
      </fieldset>

      <Note>
        If your Google Cloud project hasn&apos;t passed YouTube&apos;s API audit, YouTube keeps uploads private whatever you choose
        here.
      </Note>

      {titleError && title && <ErrorText>{titleError}</ErrorText>}
      <button onClick={handlePublish} disabled={!ready} className={primaryButtonClass}>
        {busy ? "Uploading..." : "Upload to YouTube"}
      </button>
      {!busy && !ready && (
        <p className="text-xs text-zinc-500">
          {madeForKids === null ? "Answer whether the video is made for kids. " : ""}
          {!allChecked ? "Confirm every item in the rights and monetization checklist." : ""}
        </p>
      )}
      <JobProgress jobId={jobId} job={job} starting={starting} startError={startError} />
    </div>
  );
}

function Published({ published }: { published: NonNullable<StepProps["project"]["published"]> }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
      <p className="font-medium text-emerald-800 dark:text-emerald-300">Uploaded to YouTube</p>
      <p className="text-emerald-800/80 dark:text-emerald-300/80">
        YouTube is processing it now. In YouTube Studio you can add a thumbnail and end screens, check copyright claims, and
        see whether ads can run on it.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a href={published.url} target="_blank" rel="noopener noreferrer" className={`${buttonClass} flex-1 text-center`}>
          Watch on YouTube
        </a>
        <a href={published.studioUrl} target="_blank" rel="noopener noreferrer" className={`${buttonClass} flex-1 text-center`}>
          Open in YouTube Studio
        </a>
      </div>
    </div>
  );
}

function SetupHelp() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-700">
      <p className="font-medium">Set up YouTube publishing</p>
      <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        <li>In Google Cloud Console, create a project and enable the YouTube Data API v3.</li>
        <li>Set up the OAuth consent screen and add your Google account as a test user.</li>
        <li>Create an OAuth client ID of type &quot;Desktop app&quot;.</li>
        <li>
          Start the backend with <code>YOUTUBE_CLIENT_ID</code> and <code>YOUTUBE_CLIENT_SECRET</code> set to that client&apos;s
          values, then reload this page.
        </li>
      </ol>
      <p className="text-xs text-zinc-500">Until then, save the final video and upload it in YouTube Studio.</p>
    </div>
  );
}
