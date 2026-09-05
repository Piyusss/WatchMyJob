"use client";

import { useState } from "react";
import SampleLogo from "@/components/SampleLogo";
import { cn } from "@/lib/utils";

// Routed through our own handler rather than straight at the icon provider.
// The provider answers an unknown domain with a 404 that still carries a
// valid grey-placeholder PNG, and browsers happily render an image served
// with a 404, so onError never fired and made-up domains showed the grey
// square instead of the mark below. api/company-logo collapses that into an
// empty 404 that does fire onError (see the comment in that file).
//
// Deliberately not stored as a URL on the company: keeping only the domain
// lets the provider change again later without a migration or a backfill.
function logoUrl(domain: string): string {
  return `/api/company-logo?domain=${encodeURIComponent(domain)}`;
}

// Every place a company appears gets the same fixed square, so a mix of
// real logos (arbitrary aspect ratios) and sample-mark tiles never causes a
// row to jump around. object-contain preserves the logo's own aspect ratio
// inside that square rather than stretching it.
export default function CompanyLogo({
  name,
  domain,
  size = 40,
  className,
}: {
  name: string;
  domain: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  // No domain on file, or one was given but its favicon didn't resolve (a
  // test company created with a placeholder/made-up domain hits this exact
  // path, since there's no real favicon to fetch). Either way, a sample mark
  // reads as "a company with a plain icon", not "this one is broken",
  // unlike a bare initial does.
  if (!domain || failed) {
    return (
      <span
        className={cn("grid shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-line", className)}
        style={{ width: size, height: size }}
      >
        {/* No bg-white here: the mark paints its own coloured tile edge to
            edge, the way a real favicon fills its square. */}
        <SampleLogo name={name} />
      </span>
    );
  }

  return (
    <span
      className={cn("grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white ring-1 ring-line", className)}
      style={{ width: size, height: size }}
    >
      {/* A plain <img>, not next/image: this is a third-party remote host
          with unpredictable dimensions per company, and the graceful-fallback
          behavior below needs a real DOM error event. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl(domain)}
        alt=""
        aria-hidden
        width={size}
        height={size}
        className="size-full object-contain p-1"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
