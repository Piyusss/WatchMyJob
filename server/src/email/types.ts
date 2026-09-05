export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  // Whatever identifier the provider assigns this send, if any: recorded
  // on the Notification row (providerMessageId) so a real send can later
  // be correlated with the provider's own logs/dashboards.
  providerMessageId: string | null;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
