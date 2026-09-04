const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  details?: Record<string, string[] | undefined>;
  constructor(message: string, details?: Record<string, string[] | undefined>) {
    super(message);
    this.details = details;
  }
}

// apiFetch is a plain function called from many places, not a hook, so it
// can't use useAuth()'s getToken() directly -- window.Clerk is the
// documented escape hatch for reaching the same session token outside a
// component. Every real caller renders after ClerkProvider has mounted
// (see useCurrentUser, which every authenticated page goes through first),
// so window.Clerk is populated by the time this actually needs a token.
async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const clerk = (window as unknown as { Clerk?: { session?: { getToken(): Promise<string | null> } } }).Clerk;
  if (!clerk?.session) return null;
  try {
    return await clerk.session.getToken();
  } catch {
    return null;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, body?.details);
  }

  return body as T;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  notificationsPaused: boolean;
  createdAt: string;
  hasPreferences: boolean;
}

export type WorkMode = "REMOTE" | "HYBRID" | "ON_SITE";
export type OpportunityType = "FULL_TIME" | "INTERNSHIP" | "CONTRACT" | "PART_TIME" | "OTHER";

export interface Preferences {
  id: string;
  userId: string;
  roleFamily: string | null;
  roleLevel: string | null;
  yearsExperience: number | null;
  toleranceYears: number | null;
  country: string | null;
  state: string | null;
  city: string | null;
  workMode: WorkMode[];
  opportunityTypes: OpportunityType[];
  effectiveSince: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  openRoles: number;
}

export interface MatchExplanation {
  roleMatched: boolean;
  levelMatched: boolean;
  experienceMatched: boolean;
  locationMatched: boolean;
  workModeMatched: boolean;
  opportunityTypeMatched: boolean;
  overallMatch: boolean;
}

export interface JobListing {
  id: string;
  title: string;
  location: string | null;
  workMode: WorkMode | null;
  sourceUrl: string;
  postedAt: string | null;
  firstSeenAt: string;
  discoveredInInitialSync: boolean;
  roleFamily: string | null;
  level: string | null;
  opportunityType: OpportunityType;
  experienceStatus: "KNOWN" | "UNKNOWN";
  requiredExperienceMin: number | null;
  requiredExperienceMax: number | null;
  company: { name: string; slug: string };
  matchExplanation: MatchExplanation | null;
}

export interface JobDetail extends JobListing {
  // Always plain text, server-converted from the source's raw HTML (see
  // jobs/routes.ts) -- an empty string means no description, never null.
  description: string;
  company: { id: string; name: string; slug: string };
  // Only the detail endpoint includes this -- the list endpoint strips it
  // (every job returned there is already known ACTIVE, since that's the
  // list's own base filter).
  status: "ACTIVE" | "CLOSED";
}

export interface JobsPage {
  jobs: JobListing[];
  nextCursor: string | null;
  total: number;
  unfilteredTotal: number;
  filtered: boolean;
}

export type JobsSort = "newest" | "updated";

export interface JobsQuery {
  limit?: number;
  cursor?: string;
  sort?: JobsSort;
  companies?: string;
  roleFamily?: string;
  level?: string;
  workMode?: WorkMode;
  opportunityType?: OpportunityType;
  location?: string;
  q?: string;
}

export function buildJobsQueryString(query: JobsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface Subscription {
  id: string;
  companyId: string;
  subscribedAt: string;
  deactivatedAt: string | null;
  active: boolean;
  company: { id: string; name: string; slug: string; status: string };
}
