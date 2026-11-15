export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <div
      className={`${className} grid place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 shadow-lg shadow-rose-500/20`}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-1/2 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
    </div>
  );
}
