import type { FastifyInstance } from "fastify";
import { GEO_DATA } from "./data.js";

// Static reference data: public and unauthenticated, same reasoning as
// GET /api/companies: nothing here is user-specific, so there's no boundary
// to enforce. The whole curated tree is small enough to return in one
// response; the frontend does the country->state->city filtering client-side
// rather than this being three separate endpoints round-tripping per level.
export async function geoRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (_request, reply) => {
    return reply.send({ countries: GEO_DATA });
  });
}
