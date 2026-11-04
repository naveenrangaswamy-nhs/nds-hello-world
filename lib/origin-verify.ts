import { ROTATION_STAGES, secrets, type SecretStore } from "./secrets";

/**
 * Proves a request came through CloudFront.
 *
 * The Lambda Function URL is public (IAM signing cannot be used because it
 * rejects browser POSTs that lack an `x-amz-content-sha256` header).
 * CloudFront adds this header with a shared secret to every origin request
 * (see infra/cloudfront.tf), overwriting any value a client sends, and the
 * proxy rejects requests without it. That keeps WAF and the CDN in front of
 * every page.
 *
 * The secret rotates in Secrets Manager (infra/secrets.tf). While CloudFront
 * edges switch over, some send the new value and some the old, so the
 * current, pending and previous values are all accepted.
 */

export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/**
 * True when the header matches one of the accepted secrets, or when no
 * secret is configured (local development, tests).
 */
export function isFromTrustedOrigin(value: string | null, accepted: readonly string[]): boolean {
  if (accepted.length === 0) return true;
  if (!value) return false;
  // Check every candidate so the time taken does not reveal which one matched.
  let match = false;
  for (const secret of accepted) match = constantTimeEqual(value, secret) || match;
  return match;
}

/**
 * Checks a request's origin header against the secret in Secrets Manager.
 * An unknown value triggers one throttled re-read, in case a rotation has
 * just started and the cached values are stale.
 */
export async function verifyOrigin(value: string | null, store: SecretStore = secrets): Promise<boolean> {
  const name = "ORIGIN_VERIFY_SECRET";
  const accepted = await store.values(name, { stages: ROTATION_STAGES });
  if (isFromTrustedOrigin(value, accepted)) return true;
  if (!value) return false;
  const fresh = await store.values(name, { stages: ROTATION_STAGES, refresh: true });
  return isFromTrustedOrigin(value, fresh);
}

/** String comparison whose timing does not reveal how many leading characters match. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
