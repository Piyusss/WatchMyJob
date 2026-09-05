import pino from "pino";

// Shared structured logger for the two standalone worker processes (the API
// server gets an equivalent pino logger for free from Fastify's own
// `logger: true` option. This exists so the source poller and
// notification worker, which are plain scripts with no framework, produce
// the same JSON-lines shape instead of the ad-hoc console.log text they had
// before).
//
// Never log: passwords, session/JWT secrets, provider API credentials,
// unsubscribe tokens, or other sensitive personal data beyond what a given
// event genuinely needs (a userId/jobId/sourceId is an opaque identifier,
// not PII, and is what every log line below actually carries).
export function createLogger(name: string) {
  return pino({ name, level: process.env.LOG_LEVEL ?? "info" });
}
