import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return NextResponse.json({
    ok: true,
    email: body.email ?? null,
    message: "Waitlist capture placeholder ready."
  });
}

