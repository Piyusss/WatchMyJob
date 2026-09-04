import { clerkMiddleware } from "@clerk/nextjs/server";

// Named proxy.ts, not middleware.ts -- Next.js 16's renamed convention for
// this file (see web/AGENTS.md: this app's Next.js has real breaking
// changes from older docs/training data). Route protection itself happens
// per-page via useCurrentUser's redirect (every real page is a client
// component -- see PROGRESS.md), not here; this just makes Clerk's auth
// state available to the app.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
