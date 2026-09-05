import Link from "next/link";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tone = "pending" | "success" | "error";

const TONE_STYLES: Record<Tone, { icon: typeof CheckCircle2; wrap: string; icon_: string }> = {
  pending: { icon: Loader2, wrap: "bg-tint text-ink-muted", icon_: "animate-spin" },
  success: { icon: CheckCircle2, wrap: "bg-brand-tint text-brand", icon_: "" },
  error: { icon: AlertCircle, wrap: "bg-danger-tint text-danger", icon_: "" },
};

// The centered single-message screen used by the two links that arrive from
// an email (verify-email, unsubscribe). Kept as one component because both
// are the same shape: status icon, title, one sentence, one way onward.
export default function StatusScreen({
  tone,
  title,
  message,
  actionHref,
  actionLabel,
}: {
  tone: Tone;
  title: string;
  message: string;
  actionHref: string;
  actionLabel: string;
}) {
  const { icon: Icon, wrap, icon_ } = TONE_STYLES[tone];

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5 py-12">
      <div className="w-full max-w-md text-center">
        <Link href="/" className="mb-10 inline-block text-base font-bold tracking-tight text-ink">
          WatchmyJob.co
        </Link>

        <div className="rounded-2xl border border-line bg-surface px-8 py-10 shadow-sm">
          <div className={cn("mx-auto flex size-11 items-center justify-center rounded-full", wrap)}>
            <Icon className={cn("size-5", icon_)} />
          </div>

          <h1 className="mt-5 font-display text-2xl leading-tight">{title}</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">{message}</p>

          <Link href={actionHref} className="mt-7 inline-block">
            <Button size="lg">{actionLabel}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
