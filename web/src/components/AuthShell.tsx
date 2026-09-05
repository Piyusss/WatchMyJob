import Link from "next/link";

// A single centered column, not the old two-panel split: the brand promise
// belongs on the landing page, not repeated on every sign-in. The soft
// blurred washes behind the card are purely atmospheric: two overlapping
// tints from the brand's own palette, so the page still reads as "this app"
// with no copy or imagery beyond the wordmark.
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-5 py-12 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-brand-tint-strong/50 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-24 size-[28rem] rounded-full bg-brand-tint/60 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <Link
          href="/"
          className="mb-7 flex items-center justify-center gap-2 text-[1.05rem] font-bold tracking-tight text-ink"
        >
          <span className="grid size-7 place-items-center rounded-md bg-brand text-[0.75rem] font-bold text-white">
            G
          </span>
          GettingShortlisted.in
        </Link>

        {children}
      </div>
    </div>
  );
}
