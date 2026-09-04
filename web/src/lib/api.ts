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
  isAdmin: boolean;
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

// A small, fixed vocabulary -- kept in sync by hand with the backend's own
// LEVEL_VALUES (preferences/schemas.ts), the same pattern already used for
// WorkMode/OpportunityType across this file and that schema.
export const LEVEL_OPTIONS = ["Intern", "Associate", "Senior", "Lead", "Staff", "Principal"] as const;
export type Level = (typeof LEVEL_OPTIONS)[number];

// The wire/storage shape for one added location. countryCode/stateCode are
// what get submitted back on save (validated server-side against the
// curated geo list); the *Name fields are what the UI displays and are
// filled in by the server on every read.
export interface PreferenceLocation {
  countryCode: string;
  countryName: string;
  stateCode: string | null;
  stateName: string | null;
  cityName: string | null;
}

export interface Preferences {
  id: string;
  userId: string;
  roleFamily: string | null;
  roleLevel: Level | null;
  yearsExperience: number | null;
  toleranceYears: number | null;
  locations: PreferenceLocation[];
  workMode: WorkMode[];
  opportunityTypes: OpportunityType[];
  effectiveSince: string;
}

export interface GeoState {
  code: string;
  name: string;
  cities: string[];
}

export interface GeoCountry {
  code: string;
  name: string;
  states: GeoState[];
}

export function getLocationOptions() {
  return apiFetch<{ countries: GeoCountry[] }>("/api/locations");
}

export function getRoleFamilyOptions() {
  return apiFetch<{ roleFamilies: string[] }>("/api/jobs/role-families");
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

// --- Admin / test companies (custom_company.txt) --------------------------
// Everything below talks to /api/admin/*, which only exists at all when the
// server has ALLOW_TEST_COMPANIES on, and only accepts requests from an
// account on its ADMIN_EMAILS allowlist -- see the server's
// testCompanies/routes.ts. A non-admin never sees the nav link that reaches
// these pages, but these calls would 403 regardless.

export interface TestCompanyListItem {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  domain: string | null;
  createdAt: string;
  openJobs: number;
  totalTestJobs: number;
}

export interface TestCompanyDetail {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE";
  domain: string | null;
  // Whether this company currently satisfies SELECTABLE_COMPANY -- i.e.
  // whether a real user could watch it right now. True immediately on
  // creation (see routes.ts's empty baseline), so this should basically
  // never read false, but it's here to make that guarantee visible rather
  // than assumed.
  selectable: boolean;
}

export interface TestJob {
  id: string;
  title: string;
  roleFamily: string;
  level: Level | null;
  workMode: WorkMode | null;
  opportunityType: OpportunityType;
  requiredExperienceMin: number | null;
  requiredExperienceMax: number | null;
  description: string | null;
  applicationUrl: string;
  published: boolean;
  publishedAt: string | null;
  locations: PreferenceLocation[];
  // The real Job row this draft produced, once published -- null until
  // then. Links straight to the real job detail page so the admin can
  // confirm, in Tab 1, exactly what Tab 2 just published.
  job: { id: string; externalJobId: string; status: "ACTIVE" | "CLOSED" } | null;
}

export interface CreateTestCompanyInput {
  name: string;
  slug?: string;
  domain?: string | null;
}

export interface TestJobInput {
  title: string;
  roleFamily: string;
  level: Level | null;
  locations: PreferenceLocation[];
  workMode: WorkMode | null;
  opportunityType: OpportunityType;
  requiredExperienceMin: number | null;
  requiredExperienceMax: number | null;
  description: string | null;
  applicationUrl: string;
}

export interface PublishTestJobResult {
  result: {
    discovered: number;
    created: number;
    updated: number;
    unchanged: number;
    reactivated: number;
    missing: number | null;
    closed: number;
    circuitBreakerTripped: boolean;
    queued: number;
    error: string | null;
    summary: string;
  };
  job: { id: string; status: "ACTIVE" | "CLOSED"; title: string } | null;
  notificationsByStatus: Record<string, number>;
}

export function listTestCompanies() {
  return apiFetch<{ companies: TestCompanyListItem[] }>("/api/admin/test-companies");
}

export function createTestCompany(input: CreateTestCompanyInput) {
  return apiFetch<{ company: { id: string; slug: string } }>("/api/admin/test-companies", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTestCompanyStatus(slug: string, status: "ACTIVE" | "INACTIVE") {
  return apiFetch<{ company: TestCompanyListItem; subscriptionsDeactivated: number }>(`/api/admin/test-companies/${slug}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function getTestCompany(slug: string) {
  return apiFetch<{ company: TestCompanyDetail; jobs: TestJob[] }>(`/api/admin/test-companies/${slug}`);
}

export function createTestJob(slug: string, input: TestJobInput) {
  return apiFetch<{ job: TestJob }>(`/api/admin/test-companies/${slug}/jobs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTestJob(jobId: string, input: TestJobInput) {
  return apiFetch<{ job: TestJob }>(`/api/admin/test-jobs/${jobId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function publishTestJob(jobId: string) {
  return apiFetch<PublishTestJobResult>(`/api/admin/test-jobs/${jobId}/publish`, { method: "POST" });
}
