import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import type { AuthConfig } from "convex/server";
import { RECEIVER_AUDIENCE, receiverIssuer } from "./lib/receiverJwt";

const receiverJwks = () => {
  const jwk = process.env.RECEIVER_JWT_PUBLIC_JWK;
  // A fresh deployment has no env vars until `bun run setup` sets them.
  if (!jwk)
    throw new Error("RECEIVER_JWT_PUBLIC_JWK is not set on this deployment: run `bun run setup`.");
  return { keys: [{ ...JSON.parse(jwk), alg: "ES256", use: "sig", kid: "receiver" }] };
};

export default {
  providers: [
    getAuthConfigProvider(),
    {
      type: "customJwt",
      issuer: receiverIssuer(),
      applicationID: RECEIVER_AUDIENCE,
      algorithm: "ES256",
      jwks: `data:text/plain;charset=utf-8;base64,${btoa(JSON.stringify(receiverJwks()))}`,
    },
  ],
} satisfies AuthConfig;
