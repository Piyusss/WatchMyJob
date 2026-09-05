import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

// Receives SES delivery/bounce/complaint events, published via SNS. SES
// itself never calls a webhook directly: an SNS topic subscribed to the
// SES configuration set delivers events here as an HTTP POST. Genuinely
// wired up and correct against AWS's documented event shapes, but (like
// SesEmailProvider itself) unverified against a live SNS subscription in
// this environment: there are no AWS credentials or SNS topic here to
// confirm the subscription against. The console email provider (dev
// default) never produces these events at all.
const snsEnvelopeSchema = z.object({
  Type: z.enum(["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"]),
  Message: z.string(),
  SubscribeURL: z.string().url().optional(),
});

const sesEventSchema = z.object({
  notificationType: z.enum(["Delivery", "Bounce", "Complaint"]),
  mail: z.object({ messageId: z.string() }),
  bounce: z.object({ bounceType: z.string() }).optional(),
});

export async function webhookRoutes(fastify: FastifyInstance) {
  // SNS posts with Content-Type: text/plain (a long-standing SNS quirk,
  // not a client bug): Fastify's default JSON parser only engages for
  // application/json, so without this the body would arrive as an
  // unparsed Buffer.
  fastify.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  fastify.post("/ses", async (request, reply) => {
    // Deliberately NOT full SNS message-signature verification (that
    // requires fetching and caching AWS's rotating signing certificate:
    // real added complexity). This shared secret is the proportionate
    // amount of protection for what the endpoint can actually do if
    // spoofed: flip already-idempotent, non-destructive notification
    // status fields and (for a fake Bounce/Complaint) suppress future
    // sends to an address: an availability nuisance, not a data
    // exposure. Skipped entirely when unset, which is only true in local
    // dev where no real SNS subscription exists to call this anyway.
    if (env.SES_WEBHOOK_SECRET) {
      const token = (request.query as Record<string, string | undefined>)?.token;
      if (token !== env.SES_WEBHOOK_SECRET) {
        return reply.code(401).send({ error: "Invalid webhook token" });
      }
    }

    const envelope = snsEnvelopeSchema.safeParse(request.body);
    if (!envelope.success) {
      return reply.code(400).send({ error: "Invalid SNS envelope" });
    }

    if (envelope.data.Type === "SubscriptionConfirmation") {
      // SNS requires visiting SubscribeURL once, out of band, to activate
      // the subscription. Logged rather than auto-fetched: fetching an
      // operator-unseen URL server-side is its own risk, and this is a
      // one-time setup step, not a recurring runtime concern.
      request.log.info(
        { event: "ses_webhook_subscription_confirmation" },
        "SES/SNS subscription confirmation received: visit SubscribeURL (see SNS console) to activate",
      );
      return reply.code(200).send({ status: "subscription confirmation logged" });
    }

    if (envelope.data.Type !== "Notification") {
      return reply.code(200).send({ status: "ignored" });
    }

    let sesEvent: unknown;
    try {
      sesEvent = JSON.parse(envelope.data.Message);
    } catch {
      return reply.code(400).send({ error: "Malformed SES event payload" });
    }

    const parsed = sesEventSchema.safeParse(sesEvent);
    if (!parsed.success) {
      // Not every SES event type is one this app tracks (e.g. Open/Click
      // tracking, if ever enabled): ignore unrecognized shapes rather
      // than rejecting them, so SNS doesn't retry a message this endpoint
      // was never going to act on anyway.
      return reply.code(200).send({ status: "ignored: unrecognized event shape" });
    }

    const { notificationType, mail, bounce } = parsed.data;
    const notification = await prisma.notification.findFirst({ where: { providerMessageId: mail.messageId } });
    if (!notification) {
      // Acknowledge (200) either way: an unmatched messageId isn't
      // retryable into a match, and returning an error here would just
      // make SNS keep redelivering it.
      return reply.code(200).send({ status: "no matching notification" });
    }

    if (notificationType === "Delivery") {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
    } else if (notificationType === "Bounce") {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: "BOUNCED", bouncedAt: new Date() },
      });
      if (bounce?.bounceType === "Permanent") {
        await prisma.user.update({ where: { id: notification.userId }, data: { emailHardBounced: true } });
      }
    } else if (notificationType === "Complaint") {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { status: "COMPLAINED", complainedAt: new Date() },
      });
      // Treated the same as a permanent bounce for suppression purposes:
      // continuing to email someone who marked a previous message as spam
      // damages sender reputation regardless of raw deliverability.
      await prisma.user.update({ where: { id: notification.userId }, data: { emailHardBounced: true } });
    }

    return reply.code(200).send({ status: "processed" });
  });
}
