import type { EmailProvider } from "./types.js";
import { BrevoEmailProvider } from "./brevoProvider.js";
import { ConsoleEmailProvider } from "./consoleProvider.js";
import { env } from "../config/env.js";

// Brevo is the only real provider this app sends through: it verifies a
// single SENDER ADDRESS rather than requiring an owned domain, so it's the
// path that actually delivers real email without anyone here owning a
// domain. The console fallback stays regardless: it means an environment
// with no email account configured at all (a fresh clone, CI, a teammate's
// machine) can still run the full register -> verify -> match -> notify
// pipeline end to end, with the email printed to the log instead of sent.
function buildDefaultProvider(): EmailProvider {
  if (env.BREVO_API_KEY && env.BREVO_FROM_EMAIL) {
    console.log(`[email] using Brevo (from: ${env.BREVO_FROM_NAME} <${env.BREVO_FROM_EMAIL}>).`);
    return new BrevoEmailProvider(env.BREVO_API_KEY, env.BREVO_FROM_EMAIL, env.BREVO_FROM_NAME);
  }
  console.log(
    "[email] no provider configured (set BREVO_API_KEY + BREVO_FROM_EMAIL): using the console provider: emails are printed, not sent.",
  );
  return new ConsoleEmailProvider();
}

let provider: EmailProvider = buildDefaultProvider();

export function getEmailProvider(): EmailProvider {
  return provider;
}

// Test-only seam, mirroring sources/registry.ts's setAdapterForTesting:
// lets a test observe exactly what would have been sent without a real
// provider (or real AWS credentials) involved. Never called from
// production code.
export function setEmailProviderForTesting(override: EmailProvider | undefined): void {
  provider = override ?? buildDefaultProvider();
}

