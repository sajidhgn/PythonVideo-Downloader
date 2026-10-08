/** Step icons. Paths from Lucide (ISC licence), https://lucide.dev. */

function Icon({ children, className = "size-6" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const VideoIcon = () => (
  <Icon>
    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </Icon>
);

export const ScissorsIcon = () => (
  <Icon>
    <circle cx="6" cy="6" r="3" />
    <path d="M8.12 8.12 12 12" />
    <path d="M20 4 8.12 15.88" />
    <circle cx="6" cy="18" r="3" />
    <path d="M14.8 14.8 20 20" />
  </Icon>
);

export const WandIcon = () => (
  <Icon>
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
    <path d="m14 7 3 3" />
    <path d="M5 6v4" />
    <path d="M19 14v4" />
    <path d="M10 2v2" />
    <path d="M7 8H3" />
    <path d="M21 16h-4" />
    <path d="M11 3H9" />
  </Icon>
);

export const ClapperboardIcon = () => (
  <Icon>
    <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
    <path d="m6.2 5.3 3.1 3.9" />
    <path d="m12.4 3.4 3.1 4" />
    <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </Icon>
);

export const MusicIcon = () => (
  <Icon>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Icon>
);

export const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
    <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill="currentColor" />
    <path d="m10 9 5.2 3-5.2 3z" className="fill-white dark:fill-zinc-900" />
  </svg>
);

export const ArrowDownIcon = () => (
  <Icon className="size-4">
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon className="size-3.5">
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
