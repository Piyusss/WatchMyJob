"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The controls under a list split into pages: which items are showing
 * ("15–28 of 140"), then Previous, the page numbers and Next. Nothing at
 * all when everything fits on one page.
 */
export default function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const step = "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-ink transition-colors hover:bg-ink/[0.05] disabled:pointer-events-none disabled:opacity-35";

  return (
    <nav aria-label="Pages" className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[0.875rem]">
      <p className="tabular-nums text-ink-muted">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" className={step} disabled={page === 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="size-4" />
          <span className="sr-only sm:not-sr-only">Previous</span>
        </button>
        {pageNumbers(page, pageCount).map((item, i) =>
          item === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-ink-faint">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              aria-current={item === page ? "page" : undefined}
              aria-label={`Page ${item}`}
              className={cn(
                "size-8 rounded-full tabular-nums transition-colors",
                item === page ? "bg-ink/[0.07] text-ink" : "text-ink-muted hover:bg-ink/[0.04] hover:text-ink",
              )}
            >
              {item}
            </button>
          ),
        )}
        <button type="button" className={step} disabled={page === pageCount} onClick={() => onChange(page + 1)}>
          <span className="sr-only sm:not-sr-only">Next</span>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}

// The first and last page, and the current one with its neighbours, with
// "…" where pages are skipped: 1 … 4 5 6 … 10.
function pageNumbers(page: number, count: number): (number | "…")[] {
  const shown = [...new Set([1, page - 1, page, page + 1, count])]
    .filter((p) => p >= 1 && p <= count)
    .sort((a, b) => a - b);
  const items: (number | "…")[] = [];
  shown.forEach((p, i) => {
    if (i > 0 && p - shown[i - 1] > 1) items.push("…");
    items.push(p);
  });
  return items;
}
