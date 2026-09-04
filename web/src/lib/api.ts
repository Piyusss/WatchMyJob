const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  // The HTTP status is load-bearing, not just diagnostic: callers have to be
  // able to tell "you are not signed in" (401) apart from "the server broke"
  // (500) or "you're being throttled" (429). Conflating them is what turned a
  // single server error into an unbounded redirect loop -- see useCurrentUser.
  status: number;
  details?: Record<string, string[] | undefined>;
  constructor(message: string, status: number, details?: Record<string, string[] | undefined>) {
    super(message);
    this.status = status;
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
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    // The API being unreachable (down, DNS, CORS rejection) is emphatically
    // not an auth failure -- status 0 keeps it from ever being mistaken for
    // a 401 by callers that branch on status.
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status, body?.details);
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

// This user's own stance toward a job -- distinct from the job's global
// status (see the server's schema.prisma). null means "no stance yet".
export type UserJobState = "SAVED" | "APPLIED" | "DISMISSED";

export function setJobState(jobId: string, state: UserJobState) {
  return apiFetch<{ jobId: string; state: UserJobState }>(`/api/jobs/${jobId}/state`, {
    method: "PUT",
    body: JSON.stringify({ state }),
  });
}

export function clearJobState(jobId: string) {
  return apiFetch<{ jobId: string; state: null }>(`/api/jobs/${jobId}/state`, { method: "DELETE" });
}

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
  domain: string | null;
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
  company: { name: string; slug: string; domain: string | null };
  matchExplanation: MatchExplanation | null;
  // The feed only ever returns ACTIVE jobs, but a state view (?state=SAVED)
  // deliberately keeps closed ones so "the role I applied to has closed" is
  // visible rather than silently dropped.
  status: "ACTIVE" | "CLOSED";
  userState: UserJobState | null;
}

export interface JobDetail extends JobListing {
  // Always plain text, server-converted from the source's raw HTML (see
  // jobs/routes.ts) -- an empty string means no description, never null.
  description: string;
  company: { id: string; name: string; slug: string; domain: string | null };
}

export interface JobsPage {
  jobs: JobListing[];
  nextCursor: string | null;
  total: number;
  unfilteredTotal: number;
  filtered: boolean;
}

export type JobsSort = "newest" | "updated";

export type NotificationStatus =
  | "SENDING"
  | "PROVIDER_ACCEPTED"
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED"
  | "SKIPPED"
  | "DEAD_LETTER";

export interface NotificationHistoryItem {
  id: string;
  notificationType: "NEW_JOB" | "MATCH_VIA_UPDATE";
  status: NotificationStatus;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  job: {
    id: string;
    title: string;
    location: string | null;
    status: "ACTIVE" | "CLOSED";
    company: { name: string; slug: string; domain: string | null };
  };
}

export interface CompanyDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  domain: string | null;
  openRoles: number;
  watching: boolean;
  lastSyncedAt: string | null;
  roleFamilies: { roleFamily: string; count: number }[];
  recentJobs: {
    id: string;
    title: string;
    location: string | null;
    workMode: WorkMode | null;
    opportunityType: OpportunityType;
    firstSeenAt: string;
    roleFamily: string | null;
    level: string | null;
  }[];
}

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
  state?: UserJobState;
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
