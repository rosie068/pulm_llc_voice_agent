import { clerkMiddleware } from "@clerk/nextjs/server";

// Next.js 16: this file replaces middleware.ts. Route protection happens at
// the resource (`auth.protect()` in pages/routes) per current Clerk guidance;
// this proxy only establishes auth context. /api/vapi/* stays out of the
// matcher — Vapi authenticates via X-Vapi-Secret, not Clerk.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|api/vapi|api/cron|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
