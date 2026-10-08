import Studio from "@/components/Studio";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 py-12 sm:py-20">
      <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Video Downloader & Editor</h1>
      <p className="mt-3 mb-8 text-center text-zinc-500">
        Download from YouTube, Facebook, Instagram and more, then trim, speed up, add music and set the title and alt text.
        Or turn your own footage into an animated video for YouTube.
      </p>

      <Studio />

      <p className="mt-10 text-center text-xs text-zinc-400">
        Only download and edit videos you own or have permission to use.
      </p>
    </main>
  );
}
