import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";

  if (/\bcurl\//i.test(userAgent)) {
    return NextResponse.rewrite(new URL("/connect-agent-markdown", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
