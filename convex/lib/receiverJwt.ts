import { importPKCS8, SignJWT } from "jose";

export const RECEIVER_AUDIENCE = "locarc-receiver";
export const RECEIVER_TOKEN_TTL_S = 3600;

/** Distinct from better-auth's issuer (the bare site URL), so guards can tell the two apart. */
export const receiverIssuer = () => `${process.env.CONVEX_SITE_URL}/receiver`;

export async function mintReceiverToken(receiverId: string, privateKeyPem: string) {
  const exp = Math.floor(Date.now() / 1000) + RECEIVER_TOKEN_TTL_S;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "receiver", typ: "JWT" })
    .setIssuer(receiverIssuer())
    .setAudience(RECEIVER_AUDIENCE)
    .setSubject(receiverId)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(await importPKCS8(privateKeyPem, "ES256"));
  return { token, expiresAt: exp * 1000 };
}
