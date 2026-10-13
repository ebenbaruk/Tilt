"use client";

import { getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCallback } from "react";
import { ApiError, type Auth } from "@/lib/api";

/** Builds API credentials from the Privy session. Money moves also carry a freshly refreshed identity token. */
export function useTiltAuth() {
  const { getAccessToken } = usePrivy();

  const auth = useCallback(async (): Promise<Auth> => {
    const accessToken = await getAccessToken();
    if (!accessToken) throw new ApiError("UNAUTHORIZED", "Your session expired. Log in again.", null);
    return { accessToken };
  }, [getAccessToken]);

  const moneyAuth = useCallback(async (): Promise<Auth> => {
    const base = await auth();
    // getIdentityToken re-issues the identity token via GET /users/me, so the API sees a consent proof minted just now
    // (spec §7). A separate refreshUser() would hit /users/me twice and trip Privy's 1-request rate limit.
    const identityToken = await getIdentityToken();
    if (!identityToken) {
      throw new ApiError("UNAUTHORIZED", "Identity tokens are not enabled for this login. Log in again.", null);
    }
    return { ...base, identityToken };
  }, [auth]);

  return { auth, moneyAuth };
}
