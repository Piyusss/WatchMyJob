import "dotenv/config";
import { z } from "zod";

// An unset variable and one written as VAR="" mean the same thing here.
// A .env full of empty placeholders is the normal way to document optional
// config, and treating "" as "configured, with an empty value" is actively
// dangerous: for anything carrying a format check (.email()) it fails
// validation and takes the whole process down at boot.
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),

  // Clerk is the sole auth mechanism (see auth/authenticate.ts): both
  // required, boot fails without them rather than running with auth silently
  // broken.
  CLERK_PUBLISHABLE_KEY: z.string().min(1, "CLERK_PUBLISHABLE_KEY is required"),
  CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required"),

  // Provider selection happens in email/index.ts: Brevo, if both are set,
  // else the console fallback. Brevo verifies a single SENDER ADDRESS
  // rather than requiring a domain, which is why it's viable at all
  // without anyone here owning a domain.
  BREVO_API_KEY: optional(z.string()),
  BREVO_FROM_EMAIL: optional(z.string().email()),
  BREVO_FROM_NAME: z.string().default("WatchmyJob.co"),

  // Comma-separated list of Clerk account emails allowed to reach the
  // admin/test-companies surface (see auth/authenticate.ts's requireAdmin).
  // Reuses the existing Clerk-authenticated session rather than a second
  // credential system: this only adds an authorization check on top of
  // "already signed in", the same way every other admin surface in this
  // codebase (admin:companies et al.) assumes whoever can reach it is
  // trusted, except this one has a real HTTP surface so that trust has to
  // be an explicit, checked allowlist instead of "has shell access."
  ADMIN_EMAILS: optional(z.string()),

  // Section 17 of custom_company.txt: the admin/test-companies feature must
  // be safely gated, on by default in dev/staging and off by default in
  // production unless explicitly enabled. Left unset, the default below
  // (env.ts's own isProduction) applies; set explicitly to override either
  // direction.
  ALLOW_TEST_COMPANIES: optional(z.enum(["true", "false"])),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
export const allowTestCompanies =
  env.ALLOW_TEST_COMPANIES !== undefined ? env.ALLOW_TEST_COMPANIES === "true" : !isProduction;
