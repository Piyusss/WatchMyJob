"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { apiFetch, type PublicUser } from "@/lib/api";

// Several components on a single screen need the current user (the page
// itself and AuthNav, at minimum). Without this, each one fires its own
// /api/auth/me on mount. Callers share one in-flight request and one
// resolved result instead; `invalidateCurrentUser` exists for the places
// that change the answer (login, logout, saving preferences).
let cached: PublicUser | null = null;
let inFlight: Promise<PublicUser> | null = null;

function fetchCurrentUser(): Promise<PublicUser> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = apiFetch<{ user: PublicUser }>("/api/auth/me")
      .then((res) => {
        cached = res.user;
        return res.user;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function invalidateCurrentUser() {
  cached = null;
  inFlight = null;
}

export function useCurrentUser() {
  const router = useRouter();
  // isLoaded gates on Clerk having hydrated at all; isSignedIn is only
  // meaningful once it has. Firing /api/auth/me before isLoaded would race
  // window.Clerk not existing yet (see api.ts's getAuthToken) and could
  // send an unauthenticated request for an actually-signed-in user.
  const { isLoaded, isSignedIn } = useAuth();
  const [user, setUser] = useState<PublicUser | null>(cached);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    let active = true;
    fetchCurrentUser()
      .then((u) => {
        if (active) setUser(u);
      })
      .catch(() => {
        if (active) router.replace("/login");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, router]);

  return { user, loading };
}
