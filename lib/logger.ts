import pino, { type Logger, type LoggerOptions } from "pino";

/**
 * Application logger.
 *
 * - Structured JSON on stdout in production (CloudWatch Logs picks it up
 *   from Lambda with no agent). Pretty-printed in development.
 * - Synchronous writes, so nothing is lost when a Lambda execution
 *   environment is frozen immediately after the response is sent.
 * - Redaction of anything that could identify a person or carry a secret,
 *   applied before a line is written.
 *
 * Use `getRequestLogger()` from lib/request-context.ts inside pages, layouts
 * and route handlers so lines carry the request and trace IDs. Use this
 * base `logger` only outside a request (startup, background work).
 */

const isProduction = process.env.NODE_ENV === "production";
const useJson = isProduction || process.env.LOG_FORMAT === "json";

/** Field names that must never reach a log line, at any depth we log. */
const SENSITIVE_FIELDS = [
  "nhsNumber",
  "nhs_number",
  "email",
  "emailAddress",
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "authorization",
  "cookie",
  "set-cookie",
  "dateOfBirth",
  "dob",
  "postcode",
  "phone",
  "telephone",
  "mobile",
  "firstName",
  "lastName",
  "fullName",
  "address",
  "ip",
  "ipAddress",
];

/** Pino redact paths: each sensitive field at the top level and up to three levels deep. */
export const REDACT_PATHS = SENSITIVE_FIELDS.flatMap((field) => {
  const key = /^[A-Za-z_$][\w$]*$/.test(field) ? field : `["${field}"]`;
  const nested = /^\[/.test(key) ? key : `.${key}`;
  return [key, `*${nested}`, `*.*${nested}`, `*.*.*${nested}`];
});

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  messageKey: "message",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: {
    service: process.env.SERVICE_NAME ?? "nhs-helloworld",
    version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "dev",
    env: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    ...(process.env.AWS_LAMBDA_FUNCTION_NAME && {
      lambda: {
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
        region: process.env.AWS_REGION,
      },
    }),
  },
};

function createLogger(): Logger {
  if (useJson) {
    return pino(baseOptions, pino.destination({ fd: 1, sync: true }));
  }
  return pino({
    ...baseOptions,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,service,version,env",
        messageKey: "message",
      },
    },
  });
}

// Reuse one instance across dev-server hot reloads so we do not spawn a new
// pretty-printer worker thread on every change.
const globalForLogger = globalThis as unknown as { __nhsLogger?: Logger };

export const logger: Logger = globalForLogger.__nhsLogger ?? createLogger();
if (!isProduction) globalForLogger.__nhsLogger = logger;

/** Serialises an unknown thrown value into log-friendly fields. */
export function errorFields(err: unknown) {
  if (err instanceof Error) {
    return {
      error: {
        name: err.name,
        message: err.message,
        stack: err.stack,
        digest: (err as { digest?: string }).digest,
        cause: err.cause instanceof Error ? err.cause.message : undefined,
      },
    };
  }
  return { error: { name: "NonError", message: String(err) } };
}
