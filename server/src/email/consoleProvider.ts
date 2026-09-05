import crypto from "node:crypto";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types.js";

// Local-dev stand-in: prints the email instead of sending it, so the
// register -> verify -> login flow (and now the notification pipeline)
// works without a real Brevo account. Used automatically whenever
// BREVO_API_KEY/BREVO_FROM_EMAIL aren't configured (see index.ts).
export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const providerMessageId = `console-${crypto.randomUUID()}`;
    console.log("\n--- Email (console provider) ---");
    console.log(`To:      ${message.to}`);
    console.log(`Subject: ${message.subject}`);
    console.log(`Id:      ${providerMessageId}`);
    console.log(message.text);
    console.log("---------------------------------\n");
    return { providerMessageId };
  }
}
