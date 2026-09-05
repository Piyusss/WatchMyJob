export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  providerMessageId: string | null;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}
