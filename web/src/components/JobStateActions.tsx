"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bookmark, Check, X } from "lucide-react";
import { setJobState, clearJobState, ApiError, type UserJobState } from "@/lib/api";
import { cn } from "@/lib/utils";

// Save / Applied / Dismiss for one job.
//
// The three states are mutually exclusive by design (see the server's
// schema.prisma), so these read as a small radio group rather than three
// independent toggles: marking a saved job Applied moves it, it doesn't
// stack. Clicking the state a job is already in clears it, which is how a
// user un-saves or un-dismisses.
export default function JobStateActions({
  jobId,
  state,
  onChange,
  className,
}: {
  jobId: string;
  state: UserJobState | null;
  onChange?: (state: UserJobState | null) => void;
  className?: string;
}) {
  const [pending, setPending] = useState(false);

  // Deliberately not optimistic. Dismiss removes the row from the feed
  // entirely, so an optimistic update that later failed would leave the user
  // believing a job is gone when the server still has it in their feed.
  async function apply(next: UserJobState | null, options?: { undoable?: boolean; label?: string }) {
    if (pending) return;
    setPending(true);
    try {
      if (next === null) {
        await clearJobState(jobId);
      } else {
        await setJobState(jobId, next);
      }
      onChange?.(next);

      if (options?.label) {
        toast.success(options.label, {
          action: options.undoable
            ? {
                label: "Undo",
                onClick: () => {
                  // Restores whatever the state was before this click, not
                  // unconditionally null: undoing a dismiss on a job that
                  // was saved beforehand should give the save back.
                  void apply(state, { label: "Undone" });
                },
              }
            : undefined,
        });
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't update this job. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const buttonBase =
    "relative z-10 grid size-8 place-items-center rounded-md border transition-colors disabled:opacity-50";

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <button
        type="button"
        disabled={pending}
        aria-pressed={state === "SAVED"}
        aria-label={state === "SAVED" ? "Remove from saved" : "Save job"}
        title={state === "SAVED" ? "Saved" : "Save"}
        onClick={() =>
          apply(state === "SAVED" ? null : "SAVED", { label: state === "SAVED" ? "Removed from saved" : "Saved" })
        }
        className={cn(
          buttonBase,
          state === "SAVED"
            ? "border-brand/30 bg-brand-tint text-brand-ink"
            : "border-line text-ink-faint hover:bg-tint hover:text-ink-secondary",
        )}
      >
        <Bookmark className={cn("size-4", state === "SAVED" && "fill-current")} />
      </button>

      <button
        type="button"
        disabled={pending}
        aria-pressed={state === "APPLIED"}
        aria-label={state === "APPLIED" ? "Unmark as applied" : "Mark as applied"}
        title={state === "APPLIED" ? "Applied" : "Mark applied"}
        onClick={() =>
          apply(state === "APPLIED" ? null : "APPLIED", {
            label: state === "APPLIED" ? "No longer marked applied" : "Marked as applied",
          })
        }
        className={cn(
          buttonBase,
          // Solid dark rather than a second green: --brand is already emerald
          // and carries "Saved" here, so a green "Applied" would read as the
          // same state twice.
          state === "APPLIED"
            ? "border-ink bg-ink text-canvas"
            : "border-line text-ink-faint hover:bg-tint hover:text-ink-secondary",
        )}
      >
        <Check className="size-4" />
      </button>

      <button
        type="button"
        disabled={pending}
        aria-pressed={state === "DISMISSED"}
        aria-label={state === "DISMISSED" ? "Undo dismiss" : "Dismiss job"}
        title={state === "DISMISSED" ? "Dismissed" : "Dismiss"}
        onClick={() =>
          apply(state === "DISMISSED" ? null : "DISMISSED", {
            label: state === "DISMISSED" ? "Restored to your feed" : "Dismissed",
            // Only the dismiss direction gets Undo: it's the one action that
            // makes the row vanish, so it's the one the user can't easily
            // reverse by clicking the same button again.
            undoable: state !== "DISMISSED",
          })
        }
        className={cn(
          buttonBase,
          state === "DISMISSED"
            ? "border-danger/30 bg-danger-tint text-danger"
            : "border-line text-ink-faint hover:bg-tint hover:text-ink-secondary",
        )}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
