import type { EmailMessage, EmailProvider, EmailSendResult } from "./types.js";

// Brevo's transactional email API (v3), called directly via fetch -- same
// reasoning as resendProvider.ts: one less SDK to keep current, and it keeps
// failure handling explicit. Chosen alongside Resend specifically because
// Brevo verifies a single SENDER ADDRESS rather than requiring a domain
// (Resend has no equivalent -- domain verification only), so a real user can
// receive real email without anyone here owning a domain.
const ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 15_000;

interface BrevoSuccess {
  messageId: string;
}

interface BrevoErrorBody {
  code?: string;
  message?: string;
}

export class BrevoEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fromName: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          // The key is only ever placed here -- never logged, never included
          // in a thrown error message (see the failure paths below).
          "api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: this.fromEmail, name: this.fromName },
          to: [{ email: message.to }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      // Network failure or timeout. Thrown, not swallowed: the notification
      // pipeline's own catch records the attempt, schedules a backoff retry
      // and eventually dead-letters -- exactly what should happen here.
      const isAbort = err instanceof Error && err.name === "AbortError";
      throw new Error(
        isAbort
          ? `Brevo request timed out after ${TIMEOUT_MS}ms`
          : `Brevo request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.text();

    if (!response.ok) {
      // Brevo's documented shape is {code, message}; fall back to the
      // truncated raw body for anything else (an HTML error page, a shape
      // change) rather than assuming a field that may not be there.
      let detail = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body) as BrevoErrorBody;
        if (parsed.message) detail = parsed.code ? `${parsed.code}: ${parsed.message}` : parsed.message;
      } catch {
        // non-JSON body -- the truncated raw text is the best detail we have
      }
      throw new Error(`Brevo rejected the send (${response.status}): ${detail}`);
    }

    try {
      const parsed = JSON.parse(body) as BrevoSuccess;
      return { providerMessageId: parsed.messageId ?? null };
    } catch {
      // A 2xx with an unreadable body means it very likely WAS accepted --
      // treat it as sent with an unknown id rather than throwing, which
      // would retry and risk a duplicate email.
      return { providerMessageId: null };
    }
  }
}
