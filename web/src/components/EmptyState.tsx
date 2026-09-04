import type { LucideIcon } from "lucide-react";

// The shared shape for "there is nothing here" across the app. Intentional
// rather than a bare sentence: an empty screen should still say what this
// place is for and offer the one action that fills it.
export default function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/50 px-6 py-14 text-center">
      <div className="mx-auto grid size-10 place-items-center rounded-full bg-tint text-ink-muted">
        <Icon className="size-4.5" />
      </div>
      <h3 className="mt-4 text-[0.95rem] font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-[0.86rem] leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
