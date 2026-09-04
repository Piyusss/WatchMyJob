"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type PublicUser } from "@/lib/api";

// Several components on a single screen need the current user (the page
// itself and AuthNav, at minimum). Without this, each one fires its own
// /api/auth/me on mount. Callers share one in-flight request and one
// resolved result instead; `invalidateCurrentUser` exists for the places
// that change the answer (login, logout, verifying an email).
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
  const [user, setUser] = useState<PublicUser | null>(cached);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
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
  }, [router]);

  return { user, loading };
}
