import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { base64url, randomToken } from "@/convex/lib/crypto";

// Every key the Convex app declares, generated fresh. `siteUrl` is the website origin.
export async function generateDeploymentEnv(siteUrl: string): Promise<Record<string, string>> {
  const receiver = await generateKeyPair("ES256", { extractable: true });
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const vapidPrivate = await crypto.subtle.exportKey("jwk", vapid.privateKey);
  return {
    SITE_URL: siteUrl,
    BETTER_AUTH_SECRET: randomToken(32),
    // One line, so it survives .env files; jose ignores the missing line breaks.
    RECEIVER_JWT_PRIVATE_KEY: (await exportPKCS8(receiver.privateKey)).replaceAll("\n", ""),
    RECEIVER_JWT_PUBLIC_JWK: JSON.stringify(await exportJWK(receiver.publicKey)),
    VAPID_PUBLIC_KEY: base64url(
      new Uint8Array(await crypto.subtle.exportKey("raw", vapid.publicKey)),
    ),
    VAPID_PRIVATE_KEY: vapidPrivate.d ?? "",
    VAPID_SUBJECT: siteUrl,
  };
}

export function toDotenv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}='${v}'`)
    .join("\n");
}
