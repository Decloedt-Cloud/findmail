import { NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/login", "/api/health"]);

function hasSession(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return /(?:^|;\s*)(?:__Secure-)?authjs\.session-token=|(?:^|;\s*)(?:__Secure-)?next-auth\.session-token=/.test(cookie);
}

export function proxy(request: Request) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname.startsWith("/api/auth") || pathname === "/api/integrations/wayo-ads/creators" || PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (hasSession(request)) {
    if (pathname === "/login") return NextResponse.redirect(new URL("/dashboard", url));
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const login = new URL("/login", url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
