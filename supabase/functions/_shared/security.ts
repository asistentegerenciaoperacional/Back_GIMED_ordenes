import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export const randomToken = () => randomBytes(32).toString("base64url");
export const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");
export const pkce = (input: string) => createHash("sha256").update(input).digest("base64url");

export function equalSecret(actual: string | null, expected: string) {
  if (!actual) return false;
  return timingSafeEqual(Buffer.from(sha256(actual), "hex"), Buffer.from(sha256(expected), "hex"));
}

export function encryptedTokens(hexKey: string) {
  const key = crypto.subtle.importKey("raw", new Uint8Array(Buffer.from(hexKey, "hex")), "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    async encrypt(input: string, scope: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(scope) },
        await key, new TextEncoder().encode(input));
      return Buffer.concat([iv, new Uint8Array(cipher)]).toString("base64url");
    },
    async decrypt(input: string, scope: string) {
      const buffer = Buffer.from(input, "base64url");
      const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(buffer.subarray(0, 12)),
        additionalData: new TextEncoder().encode(scope) }, await key, new Uint8Array(buffer.subarray(12)));
      return new TextDecoder().decode(clear);
    },
  };
}
