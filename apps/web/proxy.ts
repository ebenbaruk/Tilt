// Per-request Content-Security-Policy with a nonce: Next stamps it on its own scripts (pages are
// rendered per request, see app/layout.tsx), and 'strict-dynamic' lets those load the rest. No
// 'unsafe-inline' for scripts: an injected inline script does not run.
import { NextResponse, type NextRequest } from "next/server";

const isDev = process.env.NODE_ENV === "development";
// Waitlist deployment: only the landing (and its archived first version), the legal pages and the
// signup route exist; the app pages need the api, which isn't public yet.
const landingOnly = process.env.LANDING_ONLY === "true";
const LANDING_PATHS = /^\/(legal\/[a-z-]+|api\/waitlist|archive\/landing-v1)?$/;

// When the api runs on another host than the site (the site on Vercel, the api on our server), the
// site relays /v1 and /health to it: the mod only opens a login link on the api's own host or its
// parent domain (apps/mod/hooks/urls.ts), so players must reach both through one origin.
const API_UPSTREAM = process.env.API_UPSTREAM || null;
// Proves to the upstream edge that the caller's address and country below come from us.
const EDGE_SECRET = process.env.EDGE_SECRET ?? "";
if (API_UPSTREAM && EDGE_SECRET.length < 32) throw new Error("API_UPSTREAM needs an EDGE_SECRET of 32+ characters");
const API_PATHS = /^\/(health|v1(\/.*)?)$/;
const EDGE_HEADER = "x-tilt-edge";
// Vercel overwrites x-real-ip and x-vercel-ip-country with the caller's address and country, but
// drops its x-vercel-* headers on the way out, and the tunnel in front of the api replaces
// X-Forwarded-For with its own caller (Vercel): both travel in our own headers.
const CLIENT_IP_HEADER = "x-tilt-client-ip";
const COUNTRY_HEADER = "x-tilt-country";

function toApi(request: NextRequest, upstream: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(EDGE_HEADER, EDGE_SECRET);
  headers.set(CLIENT_IP_HEADER, request.headers.get("x-real-ip") ?? "");
  headers.set(COUNTRY_HEADER, request.headers.get("x-vercel-ip-country") ?? "");
  const url = new URL(request.nextUrl.pathname + request.nextUrl.search, upstream);
  return NextResponse.rewrite(url, { request: { headers } });
}

/** Origin only: CSP sources must not carry a path. */
function origin(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL is not a valid URL: "${url}"`);
  }
}

// Privy domains from docs.privy.io/security/implementation-guide/content-security-policy.
const PRIVY_FRAMES = "https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org";
const PRIVY_CONNECT =
  "https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com";
const CAPTCHA = "https://challenges.cloudflare.com";
const API_ORIGIN = origin(process.env.NEXT_PUBLIC_API_URL);

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // The host list is a fallback for browsers without 'strict-dynamic' (which ignore it otherwise).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${CAPTCHA}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `child-src ${PRIVY_FRAMES}`,
    `frame-src ${PRIVY_FRAMES} ${CAPTCHA}`,
    `connect-src 'self' ${API_ORIGIN} ${PRIVY_CONNECT}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  if (landingOnly && !LANDING_PATHS.test(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (API_UPSTREAM && API_PATHS.test(request.nextUrl.pathname)) {
    return toApi(request, API_UPSTREAM);
  }
  // Prefetches go through for the gate above, but get no nonce: it would not match the page's.
  if (request.headers.get("next-router-prefetch") || request.headers.get("purpose") === "prefetch") {
    return NextResponse.next();
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  // Next reads the nonce from the request's CSP header while rendering.
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
