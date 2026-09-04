import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    // Only set alongside userId on a real (non-test) authenticated
    // request -- needed anywhere that has to act on the Clerk account
    // itself, e.g. deleting it (see account/routes.ts).
    clerkUserId?: string;
  }
}
