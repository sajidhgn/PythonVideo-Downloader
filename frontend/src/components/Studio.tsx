"use client";

import { useState } from "react";
import Downloader from "@/components/Downloader";
import Editor from "@/components/Editor";
import type { EditSource } from "@/lib/api";

const TABS = [
  { id: "download", label: "Download" },
  { id: "edit", label: "Edit" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function Studio() {
  const [tab, setTab] = useState<Tab>("download");
  const [editSource, setEditSource] = useState<EditSource | null>(null);

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

      {/* Both stay mounted so a running download isn't lost when switching tabs. */}
      <div hidden={tab !== "download"}>
        <Downloader
          onEdit={(source) => {
            setEditSource(source);
            setTab("edit");
          }}
        />
      </div>
      <div hidden={tab !== "edit"}>
        <Editor source={editSource} onSourceChange={setEditSource} />
      </div>
    </div>
  );
}
