import pino from "pino";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS, errorFields } from "../logger";

/** Builds a logger with the real redaction config that writes to memory. */
function captureLogger() {
  const lines: string[] = [];
  const stream = { write: (line: string) => lines.push(line) };
  const log = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }, stream);
  return { log, last: () => JSON.parse(lines.at(-1) ?? "{}") };
}

describe("redaction", () => {
  it("redacts identifiers at the top level and nested", () => {
    const { log, last } = captureLogger();
    log.info({
      nhsNumber: "9434765919",
      user: { email: "a@b.nhs.uk", firstName: "Ann" },
      req: { headers: { cookie: "session=abc", authorization: "Bearer x" } },
      form: { patient: { details: { dateOfBirth: "1980-01-01" } } },
    });
    const line = last();
    expect(line.nhsNumber).toBe("[REDACTED]");
    expect(line.user.email).toBe("[REDACTED]");
    expect(line.user.firstName).toBe("[REDACTED]");
    expect(line.req.headers.cookie).toBe("[REDACTED]");
    expect(line.req.headers.authorization).toBe("[REDACTED]");
    expect(line.form.patient.details.dateOfBirth).toBe("[REDACTED]");
  });

  it("leaves operational fields alone", () => {
    const { log, last } = captureLogger();
    log.info({ event: "http.request", path: "/", requestId: "abc", lambda: { functionName: "f" } });
    const line = last();
    expect(line.event).toBe("http.request");
    expect(line.path).toBe("/");
    expect(line.lambda.functionName).toBe("f");
  });
});

describe("errorFields", () => {
  it("captures name, message, stack and digest", () => {
    const err = Object.assign(new Error("boom"), { digest: "123" });
    const fields = errorFields(err);
    expect(fields.error.name).toBe("Error");
    expect(fields.error.message).toBe("boom");
    expect(fields.error.digest).toBe("123");
    expect(fields.error.stack).toContain("boom");
  });
  it("handles non-Error throws", () => {
    expect(errorFields("oops").error).toEqual({ name: "NonError", message: "oops" });
  });
});
