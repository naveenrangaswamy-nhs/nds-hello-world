import { createHmac } from "node:crypto";

/**
 * A stable, irreversible stand-in for an identifier: an HMAC-SHA256 of the
 * value under a secret key, cut to 128 bits and prefixed with its kind.
 * The same input and key always give the same pseudonym, so events can be
 * joined, but nobody can recover the input without the key.
 */
export function pseudonym(kind: "u" | "j", value: string, key: string): string {
  if (!value) throw new Error("Cannot make a pseudonym of an empty value");
  if (!key) throw new Error("Cannot make a pseudonym without a key");
  const digest = createHmac("sha256", key).update(value).digest("base64url").slice(0, 22);
  return `${kind}_${digest}`;
}
