import type { NextConfig } from "next";

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

const csp = [
  "default-src 'self'",
  // Next's bootstrap scripts are inline; without per-request nonces (static pages) they need 'unsafe-inline'.
  `script-src 'self' 'unsafe-inline' ${CAPTCHA}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `child-src ${PRIVY_FRAMES}`,
  `frame-src ${PRIVY_FRAMES} ${CAPTCHA}`,
  `connect-src 'self' ${origin(process.env.NEXT_PUBLIC_API_URL)} ${PRIVY_CONNECT}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), usb=(), payment=(), interest-cohort=()",
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
