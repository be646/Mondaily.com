import { clerkMiddleware } from "@clerk/nextjs/server";

// apps/web is the public marketing site — no page here requires auth.
// clerkMiddleware is kept (no-op gate) so Clerk context is available to /sign-in and /sign-up.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
