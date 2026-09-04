import type { EmailProvider } from "./types.js";
import { BrevoEmailProvider } from "./brevoProvider.js";
import { ConsoleEmailProvider } from "./consoleProvider.js";
import { ResendEmailProvider } from "./resendProvider.js";
import { SesEmailProvider } from "./sesProvider.js";
import { env } from "../config/env.js";

// Provider precedence: Brevo, then Resend, then SES, then the console
// fallback.
//
// Brevo is first because it verifies a single SENDER ADDRESS rather than
// requiring an owned domain -- the path that actually delivers real email
// today, before anyone here owns a domain. Resend is kept as the option for
// once a domain exists (better deliverability at scale). SES stays
// supported for anyone already on AWS. The console provider means every
// environment -- including one with no email account of any kind -- can
// still run the full register -> verify -> match -> notify pipeline end to
// end, with the email printed to the log instead of sent.
//
// None of Brevo, Resend or SES has been exercised against a live account
// from this codebase; only the console path has. The wiring is real, the
// delivery is unverified.
function buildDefaultProvider(): EmailProvider {
  if (env.BREVO_API_KEY && env.BREVO_FROM_EMAIL) {
    console.log(`[email] using Brevo (from: ${env.BREVO_FROM_NAME} <${env.BREVO_FROM_EMAIL}>).`);
    return new BrevoEmailProvider(env.BREVO_API_KEY, env.BREVO_FROM_EMAIL, env.BREVO_FROM_NAME);
  }
  if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL) {
    console.log(`[email] using Resend (from: ${env.RESEND_FROM_EMAIL}).`);
    return new ResendEmailProvider(env.RESEND_API_KEY, env.RESEND_FROM_EMAIL);
  }
  if (env.SES_FROM_EMAIL) {
    console.log(`[email] using AWS SES (from: ${env.SES_FROM_EMAIL}, region: ${env.SES_REGION}).`);
    return new SesEmailProvider(env.SES_FROM_EMAIL, env.SES_REGION);
  }
  console.log(
    "[email] no provider configured (set BREVO_API_KEY + BREVO_FROM_EMAIL) -- using the console provider: emails are printed, not sent.",
  );
  return new ConsoleEmailProvider();
}

let provider: EmailProvider = buildDefaultProvider();

export function getEmailProvider(): EmailProvider {
  return provider;
}

// Test-only seam, mirroring sources/registry.ts's setAdapterForTesting --
// lets a test observe exactly what would have been sent without a real
// provider (or real AWS credentials) involved. Never called from
// production code.
export function setEmailProviderForTesting(override: EmailProvider | undefined): void {
  provider = override ?? buildDefaultProvider();
}

