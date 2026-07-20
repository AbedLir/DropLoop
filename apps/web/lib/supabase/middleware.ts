import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnvironment } from "./env";

export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");
  const isDashboardRequest = request.nextUrl.pathname.startsWith("/dashboard");
  const requiresAuthentication = isApiRequest || isDashboardRequest;
  const environment = getSupabasePublicEnvironment();

  if (!environment) {
    if (isApiRequest) {
      return NextResponse.json(
        { error: "Supabase is not configured.", code: "supabase_not_configured" },
        { status: 503 }
      );
    }

    if (isDashboardRequest) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "?error=supabase_not_configured";
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      }
    }
  });

  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  if (requiresAuthentication && !userId) {
    if (isApiRequest) {
      return withSessionState(NextResponse.json(
        { error: "Authentication required.", code: "authentication_required" },
        { status: 401 }
      ), response);
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    const redirectResponse = NextResponse.redirect(loginUrl);
    return withSessionState(redirectResponse, response);
  }

  return response;
}

function withSessionState(target: NextResponse, sessionResponse: NextResponse): NextResponse {
  sessionResponse.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  ["cache-control", "expires", "pragma"].forEach((name) => {
    const value = sessionResponse.headers.get(name);
    if (value) {
      target.headers.set(name, value);
    }
  });
  return target;
}
