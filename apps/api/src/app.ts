// HTTP API of Tilt for the mod and the web (spec §5, §10). Fail closed: any unexpected error
// is a 500 with a generic message, never a partial success.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppDeps } from "./deps";
import { ApiError } from "./errors";
import { clientIp, IDENTITY_HEADER, rateLimit, type Env } from "./http";
import { log } from "./log";
import { authRoutes } from "./routes/auth";
import { modRoutes } from "./routes/mod";
import { publicRoutes } from "./routes/public";
import { webRoutes } from "./routes/web";

const MAX_BODY_BYTES = 8 * 1024;

export function createApp(deps: AppDeps): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    // routePath, not the raw URL: no codes, tokens or ids end up in the logs.
    log.info("request", {
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    });
  });
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: deps.config.WEB_ORIGIN,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: ["authorization", "content-type", IDENTITY_HEADER],
      maxAge: 600,
    }),
  );
  // Per IP first: a request refused there never spends a global token, so one flooding client
  // cannot drain the global bucket and lock everyone else out.
  app.use(
    "*",
    rateLimit(deps.limiters.ip, (c) => clientIp(c, deps.config)),
  );
  app.use(
    "*",
    rateLimit(deps.limiters.global, () => "global"),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json(new ApiError("INVALID_REQUEST", "body too large").body(), 413),
    }),
  );

  publicRoutes(app, deps);
  authRoutes(app, deps);
  modRoutes(app, deps);
  webRoutes(app, deps);

  app.notFound((c) => c.json(new ApiError("NOT_FOUND", "no such route").body(), 404));
  app.onError((e, c) => {
    if (e instanceof ApiError) return c.json(e.body(), e.status);
    log.error("unhandled api error", e, { method: c.req.method, route: c.req.routePath });
    const internal = new ApiError("INTERNAL_ERROR", "internal error");
    return c.json(internal.body(), internal.status);
  });

  return app;
}
