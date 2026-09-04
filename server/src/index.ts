import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { authRoutes } from "./auth/routes.js";
import { companyRoutes } from "./companies/routes.js";
import { preferencesRoutes } from "./preferences/routes.js";
import { subscriptionRoutes } from "./subscriptions/routes.js";
import { accountRoutes } from "./account/routes.js";
import { jobRoutes } from "./jobs/routes.js";
import { notificationRoutes } from "./notifications/routes.js";
import { webhookRoutes } from "./notifications/webhooks.js";
import { prisma } from "./db/prisma.js";

async function main() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
  });

  await fastify.register(cookie);

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Liveness/readiness probe -- deliberately unauthenticated (that's the
  // convention for this kind of endpoint, and it's what a load balancer or
  // uptime monitor would call) and deliberately coarse: counts only, never
  // an error message or any per-record detail. Full diagnostic detail
  // (per-source error text, sync history) stays behind admin:health, a
  // local CLI script with no HTTP surface -- see its own file for why.
  fastify.get("/health", async (_request, reply) => {
    const SOURCE_FAILURE_ALERT_THRESHOLD = 3;
    try {
      const [unhealthySources, deadLetterNotifications, queuedNotifications] = await Promise.all([
        prisma.jobSource.count({ where: { consecutiveFailures: { gte: SOURCE_FAILURE_ALERT_THRESHOLD } } }),
        prisma.notification.count({ where: { status: "DEAD_LETTER" } }),
        prisma.notification.count({ where: { status: "QUEUED" } }),
      ]);
      return {
        status: "ok",
        database: "connected",
        unhealthySources,
        deadLetterNotifications,
        queuedNotifications,
      };
    } catch (err) {
      fastify.log.error({ err }, "health check failed: database unreachable");
      reply.code(503);
      return { status: "error", database: "unreachable" };
    }
  });

  await fastify.register(authRoutes, { prefix: "/api/auth" });
  await fastify.register(companyRoutes, { prefix: "/api/companies" });
  await fastify.register(preferencesRoutes, { prefix: "/api/preferences" });
  await fastify.register(subscriptionRoutes, { prefix: "/api/subscriptions" });
  await fastify.register(accountRoutes, { prefix: "/api/account" });
  await fastify.register(jobRoutes, { prefix: "/api/jobs" });
  await fastify.register(notificationRoutes, { prefix: "/api/notifications" });
  await fastify.register(webhookRoutes, { prefix: "/api/webhooks" });

  await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
