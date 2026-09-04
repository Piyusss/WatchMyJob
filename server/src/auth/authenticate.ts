import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { verifySession } from "./tokens.js";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[env.COOKIE_NAME];
  const session = token ? verifySession(token) : null;

  if (!session) {
    reply.code(401).send({ error: "Not authenticated" });
    return reply;
  }

  request.userId = session.userId;
}
