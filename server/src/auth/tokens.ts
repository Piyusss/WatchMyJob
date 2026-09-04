import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface SessionPayload {
  userId: string;
}

const SESSION_TTL = "7d";

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: SESSION_TTL });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// The raw token goes in the email link; only its hash is persisted, so a
// leaked database never reveals a usable verification link.
export function generateVerificationToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  return { raw, hash, expiresAt };
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
