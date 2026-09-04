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

  // Clerk is the sole auth mechanism (see auth/authenticate.ts) -- both
  // required, boot fails without them rather than running with auth silently
  // broken.
  CLERK_PUBLISHABLE_KEY: z.string().min(1, "CLERK_PUBLISHABLE_KEY is required"),
  CLERK_SECRET_KEY: z.string().min(1, "CLERK_SECRET_KEY is required"),

  // Provider selection happens in email/index.ts: Brevo (both set) > Resend
  // (both set) > SES (SES_FROM_EMAIL set) > console fallback. Credentials
  // for SES come from the standard AWS SDK chain, not from here.
  //
  // Brevo is checked first: unlike Resend and SES, it verifies a single
  // SENDER ADDRESS rather than requiring a domain, so it's the path that
  // works before anyone here owns a domain.
  BREVO_API_KEY: optional(z.string()),
  BREVO_FROM_EMAIL: optional(z.string().email()),
  BREVO_FROM_NAME: z.string().default("JobDrop"),

  RESEND_API_KEY: optional(z.string()),
  // Deliberately not .email() -- Resend accepts a display-name form too,
  // e.g. "JobDrop <onboarding@resend.dev>".
  RESEND_FROM_EMAIL: optional(z.string()),

  SES_FROM_EMAIL: optional(z.string().email()),
  SES_REGION: z.string().default("us-east-1"),
  // Shared secret expected as ?token=... on the SES/SNS delivery-feedback
  // webhook (see notifications/webhooks.ts). Optional: unset in local dev
  // (where no real SNS topic exists to call it anyway), required in
  // practice once a real subscription is configured -- the subscription's
  // endpoint URL is the one place this secret needs to be embedded.
  SES_WEBHOOK_SECRET: optional(z.string()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
