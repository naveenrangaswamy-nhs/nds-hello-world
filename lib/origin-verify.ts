/**
 * Proves a request came through CloudFront.
 *
 * The Lambda Function URL is public (IAM signing cannot be used because it
 * rejects browser POSTs that lack an `x-amz-content-sha256` header).
 * CloudFront adds this header with a shared secret to every origin request
 * (see infra/cloudfront.tf), overwriting any value a client sends, and the
 * proxy rejects requests without it. That keeps WAF and the CDN in front of
 * every page.
 */

export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/**
 * True when the header matches the configured secret, or when no secret is
 * configured (local development, tests).
 */
export function isFromTrustedOrigin(
  value: string | null,
  secret: string | undefined = process.env.ORIGIN_VERIFY_SECRET,
): boolean {
  if (!secret) return true;
  if (!value) return false;
  return constantTimeEqual(value, secret);
}

/** String comparison whose timing does not reveal how many leading characters match. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
