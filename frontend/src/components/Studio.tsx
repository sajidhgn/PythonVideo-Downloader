"use client";

import { Suspense, useState } from "react";
import Pipeline from "@/components/animate/Pipeline";
import Downloader from "@/components/Downloader";
import Editor from "@/components/Editor";
import type { EditSource } from "@/lib/api";

const TABS = [
  { id: "download", label: "Download" },
  { id: "edit", label: "Edit" },
  { id: "animate", label: "Animate" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function Studio() {
  const [tab, setTab] = useState<Tab>("download");
  const [editSource, setEditSource] = useState<EditSource | null>(null);
  const [animateSource, setAnimateSource] = useState<EditSource | null>(null);

  return (
    <div className="w-full">
      <div
        role="tablist"
        className="mx-auto mb-6 flex w-fit gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-5 py-2 text-sm font-medium ${
              tab === t.id ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* All stay mounted so a running job isn't lost when switching tabs. */}
      <div hidden={tab !== "download"}>
        <Downloader
          onEdit={(source) => {
            setEditSource(source);
            setTab("edit");
          }}
          onAnimate={(source) => {
            setAnimateSource(source);
            setTab("animate");
          }}
        />
      </div>
      <div hidden={tab !== "edit"}>
        <Editor source={editSource} onSourceChange={setEditSource} />
      </div>
      <div hidden={tab !== "animate"}>
        {/* The pipeline reads its saved project from the browser, so it renders only there. */}
        <Suspense fallback={<p className="text-center text-sm text-zinc-500">Loading...</p>}>
          <Pipeline incoming={animateSource} />
        </Suspense>
      </div>
    </div>
  );
}
