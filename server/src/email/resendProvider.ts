import type { EmailMessage, EmailProvider, EmailSendResult } from "./types.js";

// Resend's REST API is a single POST, so this talks to it directly rather
// than pulling in the `resend` SDK -- one less dependency to keep current,
// and it keeps the failure handling explicit and in our hands.
const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

interface ResendSuccess {
  id: string;
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
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
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
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
          ? `Resend request timed out after ${TIMEOUT_MS}ms`
          : `Resend request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.text();

    if (!response.ok) {
      // Resend returns a JSON error body; surface its message when present,
      // and cap the length so a huge/HTML error page can't flood lastError.
      let detail = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body) as { message?: string; name?: string };
        if (parsed.message) detail = parsed.name ? `${parsed.name}: ${parsed.message}` : parsed.message;
      } catch {
        // non-JSON body -- the truncated raw text is the best detail we have
      }
      throw new Error(`Resend rejected the send (${response.status}): ${detail}`);
    }

    try {
      const parsed = JSON.parse(body) as ResendSuccess;
      return { providerMessageId: parsed.id ?? null };
    } catch {
      // A 2xx with an unreadable body means it very likely WAS accepted --
      // treat it as sent with an unknown id rather than throwing, which
      // would retry and risk a duplicate email.
      return { providerMessageId: null };
    }
  }
}
