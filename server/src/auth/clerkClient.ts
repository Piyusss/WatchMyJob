import { createClerkClient } from "@clerk/backend";
import { env } from "../config/env.js";

// Deliberately NOT `import { clerkClient } from "@clerk/fastify"`.
//
// That package builds its exported client at module-import time from
// `process.env.CLERK_SECRET_KEY || ""`. ES imports evaluate in source
// order, so @clerk/fastify is fully evaluated before config/env.js runs
// its `import "dotenv/config"` -- the singleton captures an empty key and
// every call fails with "Missing Clerk Secret Key" at runtime. It's a
// particularly nasty failure because clerkPlugin still gets its keys
// explicitly, so token *verification* keeps working and only the Backend
// API calls (user lookup, user deletion) break.
//
// Building the client from the already-validated env object sidesteps the
// ordering problem entirely: env.CLERK_SECRET_KEY can't be read until
// dotenv has run and zod has checked it.
export const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
