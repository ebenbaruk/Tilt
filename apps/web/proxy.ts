// Per-request Content-Security-Policy with a nonce: Next stamps it on its own scripts (pages are
// rendered per request, see app/layout.tsx), and 'strict-dynamic' lets those load the rest. No
// 'unsafe-inline' for scripts: an injected inline script does not run.
import { NextResponse, type NextRequest } from "next/server";

const isDev = process.env.NODE_ENV === "development";

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
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
