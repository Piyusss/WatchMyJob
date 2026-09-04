"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { apiFetch, ApiError, type PublicUser } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    let active = true;
    setError(null);
    fetchCurrentUser()
      .then((u) => {
        if (active) setUser(u);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // Only a genuine 401 means "not signed in". Redirecting on *any*
        // failure is an infinite loop: Clerk still holds a valid session, so
        // /login's <SignIn forceRedirectUrl="/dashboard"> immediately sends
        // the user back here, which re-fires this request, which fails
        // again... The loop also hammers the API hard enough to trip its
        // rate limiter, at which point every request 429s and the loop can
        // never recover on its own. Anything that isn't a 401 gets surfaced
        // to the user instead, so a broken server looks broken rather than
        // looking like a login problem.
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(err instanceof ApiError ? err.message : "Something went wrong loading your account.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, router]);

  return { user, loading, error };
}
