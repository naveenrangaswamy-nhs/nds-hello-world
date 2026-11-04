// Copies audit log lines into the Object Lock bucket.
//
// A CloudWatch Logs subscription filter ({ $.log_type = "audit" }) invokes
// this function with batches of matching lines (gzipped, base64). Each batch
// is written as one gzipped NDJSON object, one audit event per line, exactly
// as the app logged it. The bucket's default Object Lock retention applies to
// every object, so a record cannot be changed or deleted until it expires.
//
// The key is derived from the batch contents, so a retried invocation writes
// the same key instead of a second copy. The AWS SDK v3 is part of the Lambda
// Node.js runtime, so nothing is bundled.
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const { BUCKET } = process.env;

export const handler = async (event) => {
  const batch = JSON.parse(gunzipSync(Buffer.from(event.awslogs.data, "base64")).toString("utf8"));
  // CloudWatch sends a CONTROL_MESSAGE to test the subscription; it holds no records.
  if (batch.messageType !== "DATA_MESSAGE") return;

  const lines = batch.logEvents.map((e) => e.message.trim()).filter(Boolean);
  if (lines.length === 0) return;

  const body = gzipSync(lines.join("\n") + "\n");
  const first = new Date(Math.min(...batch.logEvents.map((e) => e.timestamp)));
  const day = first.toISOString().slice(0, 10).replaceAll("-", "/");
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 24);
  const key = `audit/${day}/${first.toISOString().replace(/[:.]/g, "-")}-${hash}.ndjson.gz`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/x-ndjson",
      ContentEncoding: "gzip",
    }),
  );
  console.log(JSON.stringify({ event: "audit.archived", key, records: lines.length }));
};
