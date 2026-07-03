import { NextResponse } from "next/server";

// apps/web is the public marketing site — no page here requires auth. Clerk was fully removed in the
// sovereignty pass (native auth lives on app.mondaily.com), so this middleware is a pass-through.
export default function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
