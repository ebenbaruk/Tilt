// Device-code login: the mod starts and polls (no auth), the web approves (Privy).
import type { Hono } from "hono";
import { approveDeviceLogin, pollDeviceLogin, startDeviceLogin } from "../auth/device";
import type { AppDeps } from "../deps";
import { ApiError } from "../errors";
import { clientIp, geoBlock, parseBody, rateLimit, webAuth, type Env } from "../http";
import type { DeviceApproveResponse } from "../public";
import { DeviceApproveSchema, DeviceTokenSchema } from "../schemas";

export function authRoutes(app: Hono<Env>, deps: AppDeps): void {
  const ip = (c: Parameters<typeof clientIp>[0]) => clientIp(c, deps.config.TRUST_PROXY);

  app.post("/v1/auth/device", rateLimit(deps.limiters.auth, ip), async (c) =>
    c.json(await startDeviceLogin(deps.db, deps.config.WEB_URL)),
  );

  // Polling has its own per-code interval; the IP bucket only stops floods.
  app.post("/v1/auth/device/token", rateLimit(deps.limiters.play, ip), async (c) => {
    const { deviceCode } = await parseBody(c, DeviceTokenSchema);
    return c.json(await pollDeviceLogin(deps.db, deviceCode));
  });

  app.post(
    "/v1/auth/device/approve",
    webAuth(deps.db, deps.privy),
    geoBlock(deps.geo),
    rateLimit(deps.limiters.auth, (c) => c.get("userId")),
    async (c) => {
      const userId = c.get("userId");
      if (!deps.limiters.approveFailures.has(userId)) {
        throw new ApiError("RATE_LIMITED", "too many wrong codes, try again later");
      }
      const { userCode } = await parseBody(c, DeviceApproveSchema);
      if (!(await approveDeviceLogin(deps.db, userCode, userId))) {
        deps.limiters.approveFailures.take(userId);
        throw new ApiError("NOT_FOUND", "unknown or expired code");
      }
      return c.json({ approved: true } satisfies DeviceApproveResponse);
    },
  );
}
