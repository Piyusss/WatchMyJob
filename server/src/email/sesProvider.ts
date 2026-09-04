import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types.js";

// The production path per the blueprint's tech stack -- cheapest at this
// volume, native SPF/DKIM/DMARC and suppression-list tooling. Selected
// automatically when SES_FROM_EMAIL is configured (see index.ts); falls
// back to the console provider otherwise, since this environment has no
// AWS credentials to send a real email with. Region/credentials come from
// the standard AWS SDK chain (env vars, shared config, or an instance
// role in production) -- never hardcoded here.
export class SesEmailProvider implements EmailProvider {
  private client: SESv2Client;
  private fromEmail: string;

  constructor(fromEmail: string, region: string) {
    this.fromEmail = fromEmail;
    this.client = new SESv2Client({ region });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const response = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.fromEmail,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              Html: { Data: message.html, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
    return { providerMessageId: response.MessageId ?? null };
  }
}
