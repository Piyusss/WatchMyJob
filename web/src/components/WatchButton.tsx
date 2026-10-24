"use client";

import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Watch / Watching, the same on the companies list and a company's page.
 * While you can still watch, it's a soft grey pill; once you watch, an
 * outlined one, the way Follow / Following works. The grey is a faint tint
 * of the ink colour, so it stays a gentle step lighter in dark mode too.
 */
export default function WatchButton({
  name,
  watching,
  pending,
  onClick,
}: {
  name: string;
  watching: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={watching ? "outline" : "default"}
      disabled={pending}
      onClick={onClick}
      aria-label={watching ? `Stop watching ${name}` : `Watch ${name}`}
      className={cn(
        "min-w-[6.5rem] gap-1.5 rounded-full",
        watching ? "border-line-strong text-ink hover:bg-ink/[0.04]" : "bg-ink/[0.07] text-ink hover:bg-ink/[0.12]",
      )}
    >
      {pending ? (
        "…"
      ) : watching ? (
        <>
          <Check className="size-3.5" />
          Watching
        </>
      ) : (
        <>
          <Plus className="size-3.5" />
          Watch
        </>
      )}
    </Button>
  );
}
