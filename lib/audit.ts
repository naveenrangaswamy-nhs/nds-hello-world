import { logger } from "./logger";
import { pseudonym } from "./pseudonym";
import { getRequestContext, type RequestContext } from "./request-context";
import { secrets, type SecretStore } from "./secrets";

/**
 * The audit trail.
 *
 * Audit events are JSON log lines tagged `log_type: "audit"`. A CloudWatch
 * Logs subscription filter copies only those lines to a Firehose stream,
 * which stores them in an S3 bucket with Object Lock (infra/audit.tf). They
 * are kept far longer than the 30-day app logs and cannot be altered or
 * deleted during the retention period.
 *
 * A person is identified only by `userRef`: a keyed hash of the identity
 * provider's subject ID. It is the same for the same person every time, but
 * cannot be turned back into the subject without the key. Never put an NHS
 * number, email or name in an audit event; the logger's redaction is a
 * backstop, not the plan.
 */

export type AuditOutcome = "success" | "failure" | "denied";

export type AuditEvent = {
  /** What happened, as `area.verb`, e.g. `session.sign_in` or `appointment.cancel`. */
  action: string;
  outcome: AuditOutcome;
  userRef?: string;
  /** What was acted on, as an opaque ID (never personal data). */
  target?: string;
  /** Why a failure or denial happened, as a short code such as `token_expired`. */
  reason?: string;
  details?: Record<string, string | number | boolean>;
};

const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const auditLogger = logger.child({ log_type: "audit" });

/** Writes one audit event. Pass `context` when calling outside a request. */
export async function audit(entry: AuditEvent, context?: RequestContext): Promise<void> {
  if (!ACTION.test(entry.action)) throw new Error(`Invalid audit action: ${entry.action}`);
  const ctx = context ?? (await getRequestContext().catch(() => ({}) as RequestContext));
  auditLogger.info({
    event: `audit.${entry.action}`,
    ...entry,
    requestId: ctx.requestId,
    traceId: ctx.traceId,
  });
}

/** The pseudonymous reference for a person, from their identity provider subject ID. */
export async function userRef(subject: string, store: SecretStore = secrets): Promise<string> {
  const key = await store.current("USER_REF_HMAC_KEY");
  if (!key) throw new Error("USER_REF_HMAC_KEY is not configured");
  return pseudonym("u", subject, key);
}
