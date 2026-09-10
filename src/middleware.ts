import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge convenience only: redirect anonymous users to /login and signed-in users away from /login.
 * Real authorization happens in every page (require*Page) and every service (assertAdmin / ownEmployeeId).
 */
const PUBLIC = ["/login", "/api/health", "/api/jobs/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get("nt_session")?.value);
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p));
  if (!hasSession && !isPublic) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }
  if (hasSession && pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|favicon.ico).*)"],
};
