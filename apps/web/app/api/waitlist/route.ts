import { addToWaitlist, createRateLimiter, notionConfig, parseEmail } from "@/lib/waitlist";

const allow = createRateLimiter(5, 10 * 60_000);

function reply(status: number, body: Record<string, string> = {}) {
  return Response.json(body, { status });
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(ip)) return reply(429, { error: "Too many tries. Wait a few minutes." });

  let body: { email?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "Enter a valid email." });
  }
  // Honeypot: the field is hidden from people, bots fill it. Pretend it worked.
  if (body.website) return reply(200);

  const email = parseEmail(body.email);
  if (!email) return reply(400, { error: "Enter a valid email." });

  try {
    await addToWaitlist(email, notionConfig());
  } catch (error) {
    console.error("waitlist signup failed", error);
    return reply(502, { error: "Couldn't save your email. Try again in a minute." });
  }
  return reply(200);
}
