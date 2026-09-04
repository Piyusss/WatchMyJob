"use client";

import { useState } from "react";
import { avatarColors, avatarInitial } from "@/lib/avatar";
import { cn } from "@/lib/utils";

// DuckDuckGo's public favicon-by-domain endpoint -- no API key, live and
// network-verified as of this writing (Clearbit's equivalent free logo
// endpoint, the more obvious choice, no longer resolves at all post-HubSpot
// acquisition -- confirmed dead via two independent network paths before
// picking this instead). Correctly 404s for an unknown domain rather than
// always returning 200 with a generic placeholder, which is what makes the
// onError fallback below actually work. Deliberately not stored as a URL on
// the company: keeping only the domain lets this swap providers again later
// without a migration or a backfill.
function logoUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

// Every place a company appears gets the same fixed square, so a mix of
// real logos (arbitrary aspect ratios) and initials tiles never causes a
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
  const colors = avatarColors(name);

  if (!domain || failed) {
    return (
      <span
        className={cn("grid shrink-0 place-items-center rounded-lg font-bold", className)}
        style={{ width: size, height: size, background: colors.bg, color: colors.fg, fontSize: size * 0.42 }}
      >
        {avatarInitial(name)}
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
