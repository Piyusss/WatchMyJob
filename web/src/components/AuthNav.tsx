"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { useCurrentUser, invalidateCurrentUser } from "@/lib/useCurrentUser";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Only the destinations a user navigates *between* live in the top bar.
// Account-shaped destinations (settings, sign out) live in the avatar menu
// instead. Preferences moved there too when Saved and Alerts arrived: it's a
// set-once screen, and dropping the longest label kept the bar at roughly
// its previous total width, so this still fits a 375px phone without a
// hamburger. It remains reachable from the avatar menu.
const LINKS = [
  { href: "/dashboard", label: "Jobs" },
  { href: "/saved", label: "Saved" },
  { href: "/companies", label: "Companies" },
  { href: "/notifications", label: "Alerts" },
];

export default function AuthNav() {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const { signOut } = useClerk();

  async function logout() {
    // Clear before navigating, so the next signed-in user never renders
    // against the previous one's cached identity.
    invalidateCurrentUser();
    await signOut({ redirectUrl: "/login" });
  }

  const initial = user?.name?.trim()?.charAt(0)?.toUpperCase() ?? "·";

  return (
    <nav className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur-md">
      <div className="container-app flex h-14 items-center gap-3">
        <Link
          href="/dashboard"
          aria-label="JobDrop home"
          className="flex shrink-0 items-center gap-2 text-[0.95rem] font-bold tracking-tight text-ink"
        >
          <span className="grid size-6 place-items-center rounded-md bg-brand text-[0.7rem] font-bold text-white">
            J
          </span>
          {/* The wordmark is the first thing to go on a narrow screen -- the
              mark alone still identifies the app, and the space it frees is
              what keeps the nav on one row at 375px. */}
          <span className="hidden sm:inline">JobDrop</span>
        </Link>

        {/* min-w-0 is load-bearing: without it this flex child refuses to
            shrink below its content width and pushes the account button off
            the right edge of a phone viewport. */}
        <div className="ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:ml-2 sm:gap-1 [&::-webkit-scrollbar]:hidden">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-[0.83rem] font-medium transition-colors duration-150 sm:px-2.5",
                  active ? "bg-brand-tint text-brand-ink" : "text-ink-muted hover:bg-tint hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="grid size-8 shrink-0 place-items-center rounded-full bg-tint-strong text-[0.78rem] font-semibold text-ink-secondary transition-colors hover:bg-line-strong"
          >
            {initial}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {user && (
              <>
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{user.name}</span>
                  <span className="text-xs font-normal text-ink-muted">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem render={<Link href="/preferences" />}>
              <SlidersHorizontal />
              Job preferences
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" />}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
